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
  WATER_CEILING_CYAN,
  WATER_CEILING_EDGE,
  UNDERWATER_COLOR_DEPTH,
  UNDERWATER_PARTICLES,
  MAX_FLUID_OPS_PER_TICK,
  MAX_FIRE_OPS_PER_TICK,
  FIRE_PARTICLE_CULL,
  FLAMETHROWER_RANGE,
  FLAMETHROWER_CONE,
  FLAMETHROWER_RAYS,
  FLAMETHROWER_DPS,
  THIRD_PERSON_DIST,
  THIRD_PERSON_MARGIN,
  TORCH_LIGHT_COLOR,
  FLARE_LIGHT_COLOR,
  MAX_TORCH_LIGHTS,
  TORCH_LIGHT_GATHER_DIST,
  EYE_HEIGHT,
  RESPAWN_FLASH_SECONDS,
  REACH,
  CAMERA_NEAR,
  CAMERA_FAR,
  SPACE_START_Y,
  SPACE_FULL_Y,
  ROCKET_COOLDOWN,
  worldToChunk,
} from './core/constants';
import { Tunables } from './core/tunables';
import { Block, IS_WEAPON, IS_TORCHLIKE, BURN_SECONDS } from './core/BlockTypes';
import { AMMO } from './core/ammo';
import { raycastVoxel } from './interaction/Raycast';
import { findLandSpawn } from './core/WorldGen';
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
import { Projectiles } from './fx/Projectiles';
import { Explosion } from './fx/Explosion';
import { FireRenderer } from './fx/FireRenderer';
import { TorchRenderer } from './fx/TorchRenderer';
import { ViewModel } from './fx/ViewModel';
import { PlayerModel } from './render/PlayerModel';
import { DayNight } from './render/DayNight';
import { Sky } from './render/Sky';
import { SunMoon } from './render/SunMoon';
import { Clouds } from './render/Clouds';
import { Stars } from './render/Stars';
import { SpaceLayer } from './render/SpaceLayer';
import { Composer } from './render/post/Composer';
import { ShadowMapper } from './render/shadows/ShadowMapper';
import { PlanarReflection } from './render/water/PlanarReflection';
import { Preset, PRESETS, nextPreset, presetByName, type QualitySettings } from './render/Quality';
import { TextureRegistry } from './render/textures/TextureSource';
import { ProceduralTextureSource } from './render/textures/ProceduralTextureSource';
import { ProceduralPackTextureSource } from './render/textures/proceduralPack';
import { UnderwaterOverlay } from './ui/UnderwaterOverlay';
import { UnderwaterParticles } from './render/UnderwaterParticles';
import { BubbleParticles } from './render/BubbleParticles';
import { WaterCeiling } from './render/WaterCeiling';
import { Fauna } from './world/Fauna';
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

// Far plane is large (Phase 12.5) so the distant sun/moon + planet backdrop fit;
// near is nudged up a touch to keep terrain depth precision across that range.
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
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

const spawn = findLandSpawn(seed); // dry land near origin (avoids ocean/peak spawns)
const spawnPos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
const player = new Player(world, input, spawnPos);
input.pitch = -0.2;

const outline = new BlockOutline(scene);
const breakOverlay = new BreakOverlay(scene, buildCrackAtlas());

const hotbar = new Hotbar(document.getElementById('hotbar')!, atlas.canvas);
const inventory = new Inventory(document.getElementById('inventory')!, atlas.canvas, hotbar);
const interaction = new Interaction(world, input, player, hotbar, outline, breakOverlay);

// --- feel FX (Phase 2) -----------------------------------------------------
const effects = new Effects(scene, world, input, player, atlas, document.getElementById('explosion-flash'));
const fauna = new Fauna(scene, world); // Phase 12c: wandering biome creatures
const projectiles = new Projectiles(scene, world, fauna); // Phase 15: rocket projectiles
const fireRenderer = new FireRenderer(scene); // Phase 15.3: voxel-cube flames for FireSim
const torchRenderer = new TorchRenderer(scene); // Phase 15.7: particle flames for placed torches
// Phase 15.6: first-person held item (child of the camera) + third-person body. The torch
// flame on either reuses the rocket flame ramp; embers spawn via effects.fireEmber.
const viewModel = new ViewModel(camera, atlas.texture);
scene.add(camera); // so the camera-parented first-person view model is traversed/rendered
const playerModel = new PlayerModel(scene, world, atlas.texture);
let cameraMode = 0; // 0 first-person, 1 third-person behind, 2 third-person front
const eyePos = new THREE.Vector3(); // the true eye (gameplay origin) after view-bob
const eyeDir = new THREE.Vector3(); // eye look direction
const tpAway = new THREE.Vector3(); // scratch: direction from eye to the third-person camera
// Phase 15.8: precomputed (linear) torch/flare light colours + squared gather radius.
const TORCH_COL = new THREE.Color(TORCH_LIGHT_COLOR);
const FLARE_COL = new THREE.Color(FLARE_LIGHT_COLOR);
const TORCH_GATHER_D2 = TORCH_LIGHT_GATHER_DIST * TORCH_LIGHT_GATHER_DIST;
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

// Phase 15: explosion handler — carves the (permanent) crater, applies knockback +
// damage (player health only in Survival), and seeds living fire, then triggers FX.
const explosion = new Explosion(world, player, survival, fauna, effects, prefs);

// Phase 15.2: FireSim asks for a particle at each burning cell as it ticks; emit a flame
// ember (+ occasional smoke) while flaming, smoke only while smoldering — distance-culled.
world.onFireSample = (x, y, z, flaming) => {
  const dx = x - player.pos.x;
  const dy = y - (player.pos.y + EYE_HEIGHT);
  const dz = z - player.pos.z;
  if (dx * dx + dy * dy + dz * dz > FIRE_PARTICLE_CULL * FIRE_PARTICLE_CULL) return;
  // Flame is drawn as voxel cubes (FireRenderer); here we add the rising smoke + embers.
  if (flaming) {
    if (Math.random() < 0.7) effects.fireSmoke(x, y, z);
    if (Math.random() < 0.5) effects.fireEmber(x, y, z); // glowing bits rising into the smoke
  } else {
    effects.fireSmoke(x, y, z); // smoldering: smoke only
  }
};

// --- cinematic (Phase 4a) --------------------------------------------------
let settings: QualitySettings = PRESETS[Preset.MEDIUM];
const dayNight = new DayNight();
const sky = new Sky(scene);
const sunMoon = new SunMoon(scene);
const clouds = new Clouds(scene);
const stars = new Stars(scene);
const spaceLayer = new SpaceLayer(scene, seed); // Phase 12.5b: planet backdrop in space
const composer = new Composer(renderer, scene, camera, settings);
const shadowMapper = new ShadowMapper(materials.shared);
const planarReflection = new PlanarReflection(materials.shared);
const tmpSunUv = new THREE.Vector3();

// Phase 5/7b: underwater tint + fog override + drifting motes. Precompute both
// colorspaces (shallow + deep) so the override matches DayNight's (linear under ACES).
const underwaterOverlay = new UnderwaterOverlay(document.getElementById('underwater-tint')!);
const underwaterParticles = new UnderwaterParticles(scene, UNDERWATER_PARTICLES);
const bubbles = new BubbleParticles(scene); // Phase 11.5: bubbles rising from the player
const waterCeiling = new WaterCeiling(scene); // Phase 11.5b: visible surface from below
let wasSubmerged = false; // edge-detect surface crossings for the splash
let splashCooldown = 0; // rate-limits splash so bobbing at the surface doesn't spam
let attackCooldown = 0; // Phase 12d: melee swing rate-limit
let currentAmmo = 0; // Phase 15.1: selected rocket warhead (index into AMMO)
let flameActive = false; // Phase 15.5: flamethrower roar loop on/off
const flameDir = new THREE.Vector3(); // scratch for flamethrower cone rays
let bubbleSfxTimer = 0; // throttles occasional bubble blips while submerged
const uwFogColorSRGB = new THREE.Color(UNDERWATER_FOG_COLOR);
const uwFogColorLinear = uwFogColorSRGB.clone().convertSRGBToLinear();
const uwDeepColorSRGB = new THREE.Color(UNDERWATER_DEEP_COLOR);
const uwDeepColorLinear = uwDeepColorSRGB.clone().convertSRGBToLinear();
// Phase 11.5e: the surface-ceiling sheet (bright lit cyan) + its grazing-edge ocean blue.
const ceilCyanSRGB = new THREE.Color(WATER_CEILING_CYAN);
const ceilCyanLinear = ceilCyanSRGB.clone().convertSRGBToLinear();
const ceilEdgeSRGB = new THREE.Color(WATER_CEILING_EDGE);
const ceilEdgeLinear = ceilEdgeSRGB.clone().convertSRGBToLinear();

function applyPreset(p: Preset): void {
  settings = PRESETS[p];
  composer.setPreset(settings);
  chunkManager.setRenderDistance(settings.renderDistance);
  materials.shared.uWind.value = settings.wavingFoliage ? WIND_STRENGTH : 0;
  sky.setVisible(settings.sky);
  sunMoon.setVisible(settings.sun);
  clouds.setVisible(settings.clouds);
  stars.setVisible(settings.stars);
  spaceLayer.setEnabled(settings.planet);
  // Phase 4b: toggling only binds/unbinds maps + strengths -> no rebuild.
  shadowMapper.setActive(settings.shadows);
  planarReflection.setActive(settings.waterReflections);
  effects.setLowFx(!settings.usePost); // Phase 15: lighter explosion FX on Low
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
    updateAmmoChip(); // "Explosion power" slider changes the effective ammo power shown
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
  if (input.locked && (button === 0 || button === 2)) viewModel.triggerSwing(); // Phase 15.6 swing
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
  if (code === 'F5') {
    cameraMode = (cameraMode + 1) % 3; // first-person -> third behind -> third front
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
  if (code === 'KeyR') {
    // Phase 15.8: R is context-sensitive — toggle the held torch <-> flare (underwater
    // variant), else cycle the rocket warhead (Phase 15.1).
    const sel = hotbar.selected();
    if (IS_TORCHLIKE[sel]) {
      hotbar.setSlot(hotbar.active, sel === Block.TORCH ? Block.FLARE : Block.TORCH);
      updateTorchChip();
    } else {
      currentAmmo = (currentAmmo + 1) % AMMO.length;
      updateAmmoChip();
    }
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

// Phase 15.1: ammo indicator chip (shown only while the launcher is held). Reflects the
// selected warhead + the effective power (ammo mul × the live "Explosion power" tuning).
const ammoChip = document.getElementById('ammo')!;
function updateAmmoChip(): void {
  const a = AMMO[currentAmmo];
  ammoChip.textContent = `${a.name}  ×${(a.mul * Tunables.explosionPower).toFixed(1)}`;
}
updateAmmoChip();

// Phase 15.8: torch/flare variant chip (shown only while a torch-like item is held). R toggles.
const torchChip = document.getElementById('torchchip')!;
function updateTorchChip(): void {
  torchChip.textContent = hotbar.selected() === Block.FLARE ? 'Flare  (R)' : 'Torch  (R)';
}
updateTorchChip();

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
      world.tickFires(MAX_FIRE_OPS_PER_TICK); // Phase 15.2: spread/consume/smolder + smoke
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
  fauna.update(frameDt, player.pos, fxSkyMul); // wandering creatures (cosmetic)

  // Phase 15.6: the camera is now at the true EYE (view-bob applied). Capture it for the
  // third-person offset (applied just before render) — all gameplay reads below keep using
  // `camera` (= the eye) unchanged. Then drive the held-item / body view models.
  eyePos.copy(camera.position);
  eyeDir.copy(tmpDir); // clean (pre-bob) look direction
  const heldBlock = hotbar.selected();
  const moveSpeed = Math.hypot(player.vel.x, player.vel.z);
  const emberAt = (x: number, y: number, z: number) => effects.fireEmber(x, y, z);
  // Phase 15.8: a held TORCH goes out underwater (flare stays lit); drives both the held +
  // body flame and the dynamic light below. Quick eye-block water test (matches `submerged`).
  const headWater =
    world.getBlockWorld(Math.floor(eyePos.x), Math.floor(eyePos.y), Math.floor(eyePos.z)) === Block.WATER;
  const heldLit = !(heldBlock === Block.TORCH && headWater);
  // Phase 15.9: light the held item/arm like the world (baked sky/block light × day-night) so
  // it isn't full-bright at night; a lit torch/flare lights its own held item (floor 0.85).
  let heldLight = Math.min(1, Math.max(0.1, world.brightnessAt(Math.floor(eyePos.x), Math.floor(eyePos.y), Math.floor(eyePos.z), fxSkyMul)));
  if (IS_TORCHLIKE[heldBlock] && heldLit) heldLight = Math.max(heldLight, 0.85);
  viewModel.update(frameDt, now / 1000, heldBlock, cameraMode === 0, moveSpeed, heldLit, heldLight, emberAt);
  playerModel.setVisible(cameraMode !== 0);
  const feetX = player.prevPos.x + (player.pos.x - player.prevPos.x) * alpha;
  const feetY = player.prevPos.y + (player.pos.y - player.prevPos.y) * alpha;
  const feetZ = player.prevPos.z + (player.pos.z - player.prevPos.z) * alpha;
  playerModel.update(frameDt, now / 1000, feetX, feetY, feetZ, input.yaw, input.pitch, moveSpeed, heldBlock, heldLit, heldLight, fxSkyMul, emberAt);

  // Phase 12d melee / Phase 15 weapon: a creature under the crosshair (closer than the
  // aimed block) takes the hit instead of mining; left-click swings on a short cooldown.
  // Holding a weapon (rocket launcher) suppresses mining + fires on left-click instead.
  const weaponHeld = IS_WEAPON[hotbar.selected()] === 1;
  const creatureHit = fauna.raycast(camera.position, tmpDir, REACH);
  let meleeBlocked = false;
  if (creatureHit) {
    const tgt = interaction.target;
    const blockDist = tgt
      ? Math.hypot(tgt.cell.x + 0.5 - camera.position.x, tgt.cell.y + 0.5 - camera.position.y, tgt.cell.z + 0.5 - camera.position.z)
      : Infinity;
    meleeBlocked = creatureHit.dist < blockDist;
  }
  interaction.setMeleeBlocked(meleeBlocked || weaponHeld);
  const held = hotbar.selected();
  const isFlamethrower = held === Block.FLAMETHROWER;
  ammoChip.style.display = weaponHeld && !isFlamethrower ? 'block' : 'none'; // ammo chip is rocket-only
  torchChip.style.display = IS_TORCHLIKE[held] ? 'block' : 'none'; // Phase 15.8: torch/flare chip
  attackCooldown -= frameDt;
  const firing = input.locked && input.isMouseDown(0);

  // Phase 15.5: flamethrower — continuous (no cooldown) while held + firing. Emit the jet
  // FX, cast a cone of rays to ignite surfaces (fire life from the hit material), and burn
  // creatures in the cone; a roaring loop plays while firing.
  if (isFlamethrower && firing) {
    effects.flameJet(camera.position, tmpDir, FLAMETHROWER_RANGE);
    for (let i = 0; i < FLAMETHROWER_RAYS; i++) {
      flameDir.set(
        tmpDir.x + (Math.random() - 0.5) * 2 * FLAMETHROWER_CONE,
        tmpDir.y + (Math.random() - 0.5) * 2 * FLAMETHROWER_CONE,
        tmpDir.z + (Math.random() - 0.5) * 2 * FLAMETHROWER_CONE,
      );
      const hit = raycastVoxel(world, camera.position, flameDir, FLAMETHROWER_RANGE);
      if (hit) world.ignite(hit.place.x, hit.place.y, hit.place.z, BURN_SECONDS[hit.block] * Tunables.fireDuration);
    }
    const ch = fauna.raycast(camera.position, tmpDir, FLAMETHROWER_RANGE);
    if (ch) {
      const res = fauna.hit(ch.idx, camera.position, FLAMETHROWER_DPS * frameDt);
      if (res && res.killed) effects.onCreatureDie(res.pos, res.color);
    }
    if (!flameActive) {
      effects.startFlameroar();
      flameActive = true;
    }
  } else if (flameActive) {
    effects.stopFlameroar();
    flameActive = false;
  }

  // Rocket launcher (discrete, cooldown) / melee.
  if (firing && attackCooldown <= 0 && !isFlamethrower) {
    if (weaponHeld) {
      const power = AMMO[currentAmmo].mul * Tunables.explosionPower; // captured at fire time
      projectiles.fire(camera.position, tmpDir, power);
      attackCooldown = ROCKET_COOLDOWN;
    } else if (meleeBlocked && creatureHit) {
      const res = fauna.hit(creatureHit.idx, camera.position, 4);
      if (res) (res.killed ? effects.onCreatureDie(res.pos, res.color) : effects.onCreatureHit(res.pos, res.color));
      attackCooldown = 0.45;
    }
  }

  // Phase 15: advance rockets — trail smoke along the path; detonate (with the rocket's
  // captured power) on impact. (Fire afterglow is owned by FireSim via world.tickFires.)
  projectiles.update(
    frameDt,
    (x, y, z) => effects.explosionTrail(x, y, z),
    (pos, power) => explosion.detonate(pos, power),
  );
  fireRenderer.update(world, camera, now / 1000); // Phase 15.3: draw voxel flames for active fires
  torchRenderer.update(world, camera, now / 1000); // Phase 15.7: draw particle flames for placed torches

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
  let eyeWaterAbove = 0; // water blocks above the eye (for the waterline split)
  if (submerged) {
    const ex = Math.floor(camera.position.x);
    const ey = Math.floor(camera.position.y);
    const ez = Math.floor(camera.position.z);
    eyeWaterAbove = world.waterDepthAbove(ex, ey, ez);
    depthFrac = Math.min(eyeWaterAbove / UNDERWATER_COLOR_DEPTH, 1);
    const downwell = Math.exp(-Tunables.waterAbsorb * eyeWaterAbove); // open-column darkening
    uwBright = Math.min(world.brightnessAt(ex, ey, ez, fxSkyMul) * downwell, 1);
  }
  const lightFade = depthFrac; // surface light (sky/sun/rays) fades with local depth

  // Phase 11.5 immersion: muffle/ambience (Sfx dedupes), splash + bubble burst on
  // crossing the surface, the rising bubble stream, and occasional bubble blips.
  effects.setSubmerged(submerged);
  splashCooldown -= frameDt;
  if (submerged !== wasSubmerged) {
    if (splashCooldown <= 0) {
      effects.splash(camera.position.x, camera.position.y, camera.position.z, Math.max(fxSkyMul, 0.4));
      splashCooldown = 0.4; // don't spam while bobbing right at the surface
    }
    wasSubmerged = submerged;
  }
  const swimSpeed = Math.hypot(player.vel.x, player.vel.y, player.vel.z);
  bubbles.update(frameDt, camera, submerged, swimSpeed, world, fxSkyMul);
  if (submerged) {
    bubbleSfxTimer -= frameDt;
    if (bubbleSfxTimer <= 0) {
      effects.bubble();
      bubbleSfxTimer = 0.5 + Math.random() * 1.3;
    }
  }

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

  // Phase 12.5: how far into space we are (0 at/below the build top, 1 in full space).
  const altT = THREE.MathUtils.smoothstep(camera.position.y, SPACE_START_Y, SPACE_FULL_Y);

  sky.update(camera.position, dayNight);
  sunMoon.update(camera.position, dayNight);
  clouds.update(camera.position, dayNight, frameDt);
  stars.update(camera.position, dayNight);
  // Absorb the above-water visuals toward the deep water color as the eye descends.
  // Sky + sun/moon stay mostly bright (they show through the Snell window + feed the god-ray
  // shafts); clouds & stars are hidden entirely while submerged — they read as "sky" and
  // break the underwater illusion (the surface ceiling occludes them anyway).
  const hideFade = submerged ? 1 : 0;
  sky.setUnderwater(lightFade, settings.usePost ? uwDeepColorLinear : uwDeepColorSRGB);
  sunMoon.setUnderwaterFade(lightFade);
  stars.setUnderwaterFade(hideFade);
  clouds.setUnderwaterFade(hideFade);
  // Phase 12.5 — space transition (call AFTER the underwater fades): sky -> black,
  // stars in by day, local clouds out, atmospheric halos out. No-op at the surface.
  sky.setSpace(altT);
  stars.setSpace(altT);
  clouds.setSpace(altT);
  sunMoon.setSpace(altT);
  spaceLayer.update(camera.position, altT, dayNight);

  materials.shared.uTime.value = now / 1000;
  materials.shared.uDayFactor.value = dayNight.dayFactor;
  materials.shared.uMoonFactor.value = dayNight.moonFactor;
  materials.shared.uNightAmbient.value = dayNight.nightAmbient;
  materials.shared.uFogColor.value.copy(dayNight.fogColor);
  // Fog opens up as the atmosphere thins with altitude, so the world doesn't fog
  // out when seen from space (and you can see the curved planet/limb below).
  materials.shared.uFogDensity.value = dayNight.fogDensity * (1 - altT);
  materials.shared.uSunDir.value.copy(dayNight.sunDir);
  materials.shared.uSkyLightColor.value.copy(dayNight.skyLightColor);

  // Phase 15.7/15.8 — dynamic torch/flare lights. Placed torches/flares use the SAME light
  // as the held one (so they match): gather the held torch/flare (unless a TORCH is
  // submerged -> out) plus nearby placed torch-like blocks into the shader light array.
  // Warm for torches, red for flares. Range/brightness come from the live tuning sliders.
  const torchPositions = materials.shared.uTorchPositions.value;
  const torchColors = materials.shared.uTorchColors.value;
  let torchN = 0;
  if (IS_TORCHLIKE[heldBlock] && heldLit) {
    torchPositions[torchN].copy(eyePos);
    torchColors[torchN].copy(heldBlock === Block.FLARE ? FLARE_COL : TORCH_COL);
    torchN++;
  }
  world.forEachTorch((x, y, z, block) => {
    if (torchN >= MAX_TORCH_LIGHTS) return;
    const dx = x + 0.5 - eyePos.x;
    const dy = y + 0.6 - eyePos.y;
    const dz = z + 0.5 - eyePos.z;
    if (dx * dx + dy * dy + dz * dz > TORCH_GATHER_D2) return;
    torchPositions[torchN].set(x + 0.5, y + 0.6, z + 0.5);
    torchColors[torchN].copy(block === Block.FLARE ? FLARE_COL : TORCH_COL);
    torchN++;
  });
  materials.shared.uTorchCount.value = torchN;
  materials.shared.uTorchRange.value = Tunables.torchRange;
  materials.shared.uTorchIntensity.value = Tunables.torchIntensity * (0.9 + 0.1 * Math.sin((now / 1000) * 11));

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
  // Half-submerged waterline (Phase 11.5): when the eye sits just under the local
  // surface, split the veil so the bottom is tinted and the top is clear; the divider
  // follows look-pitch (look up -> less water). Null = full tint / off.
  let waterline: number | null = null;
  if (submerged) {
    const surfaceY = Math.floor(camera.position.y) + eyeWaterAbove; // top of the column
    if (surfaceY - camera.position.y < 0.6) {
      waterline = Math.min(1, Math.max(0, 0.5 - input.pitch * 0.7));
    }
    // Phase 11.5b/c: the visible water surface from below — a rippling ceiling at the
    // local surface. Brightness comes from the light at the SURFACE (≈ full sky in open
    // water, ≈0 in a sealed cave), NOT the doubly-absorbed light at the eye — so it
    // stays clearly visible while swimming and still dims gently with depth / at night.
    const sx = Math.floor(camera.position.x);
    const sz = Math.floor(camera.position.z);
    const surfaceLight = world.brightnessAt(sx, surfaceY, sz, fxSkyMul);
    const ceilFade = surfaceLight * (1 - 0.45 * depthFrac);
    waterCeiling.update(
      camera.position,
      surfaceY,
      now / 1000,
      ceilFade,
      Tunables.waterSurface,
      settings.usePost ? ceilCyanLinear : ceilCyanSRGB,
      settings.usePost ? ceilEdgeLinear : ceilEdgeSRGB,
    );
  } else {
    waterCeiling.hide();
  }
  underwaterOverlay.setWaterline(waterline);
  // Caustic dapple fades with depth (shallow+lit shimmers most).
  const uwCaustic = submerged ? (1 - depthFrac) * uwBright : 0;
  composer.setUnderwater(submerged ? 0.12 + 0.88 * depthFrac : 0, now / 1000, uwCaustic, 0);
  composer.setExposure(Tunables.brightness); // live "Brightness" knob (post path)
  underwaterParticles.update(frameDt, camera.position, submerged, world, fxSkyMul);

  chunkManager.update(frameDt, player.pos);

  // Phase 15.6: push the render camera off the eye for third-person (F5). All gameplay /
  // underwater logic above used the eye; everything below (shadows, reflection, god rays,
  // render) uses the offset camera. raycastVoxel pulls it in so it never clips terrain.
  // applyToCamera rewrites the camera next frame, so no restore is needed.
  if (cameraMode !== 0) {
    tpAway.copy(eyeDir).multiplyScalar(cameraMode === 1 ? -1 : 1); // behind / in front
    let dist = THIRD_PERSON_DIST;
    const tpHit = raycastVoxel(world, eyePos, tpAway, THIRD_PERSON_DIST);
    if (tpHit) {
      const hd = Math.hypot(tpHit.place.x + 0.5 - eyePos.x, tpHit.place.y + 0.5 - eyePos.y, tpHit.place.z + 0.5 - eyePos.z);
      dist = Math.min(dist, Math.max(0.4, hd - THIRD_PERSON_MARGIN));
    }
    camera.position.set(eyePos.x + tpAway.x * dist, eyePos.y + tpAway.y * dist, eyePos.z + tpAway.z * dist);
    if (cameraMode === 2) camera.lookAt(eyePos); // front view: look back at the player
    camera.updateMatrixWorld();
  }

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
      // Phase 11.5: underwater shafts sway + read a touch stronger (light-respecting,
      // scaled by how lit it is here so they stay faint at night / in caves).
      if (submerged) {
        tmpSunUv.x += Math.sin(now / 1000 * 0.6) * 0.03;
        intensity *= 1 + 0.4 * uwBright;
      }
      // No atmosphere to scatter in vacuum: the shafts fade out as you reach space.
      intensity *= 1 - altT;
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
      `seed ${seed}  ${settings.name}  ${textures.active.id}  day ${dayNight.phase.toFixed(2)}${dayNight.paused ? ' (paused)' : ''}\n` +
      `ammo ${AMMO[currentAmmo].name} ×${(AMMO[currentAmmo].mul * Tunables.explosionPower).toFixed(1)} (R to cycle)`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
