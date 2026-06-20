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
  UNDERWATER_FOG_DENSITY,
  UNDERWATER_DEEP_COLOR,
  UNDERWATER_DEEP_FOG_DENSITY,
  UNDERWATER_MAX_DEPTH,
  UNDERWATER_PARTICLES,
  WATER_SURFACE_Y,
  MAX_FLUID_OPS_PER_TICK,
  worldToChunk,
} from './core/constants';
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
import { Preset, PRESETS, nextPreset, type QualitySettings } from './render/Quality';
import { TextureRegistry } from './render/textures/TextureSource';
import { ProceduralTextureSource } from './render/textures/ProceduralTextureSource';
import { ProceduralPackTextureSource } from './render/textures/proceduralPack';
import { UnderwaterOverlay } from './ui/UnderwaterOverlay';
import { UnderwaterParticles } from './render/UnderwaterParticles';

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
  const lockHint = document.getElementById('lock-hint');
  if (lockHint) lockHint.remove();
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
const player = new Player(world, input, new THREE.Vector3(spawnX, spawnY, spawnZ));
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
let muted = false;

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
applyPreset(Preset.MEDIUM);

// --- UI glue ---------------------------------------------------------------
const lockHint = document.getElementById('lock-hint')!;
input.onLockChange = (locked) => {
  if (locked && !audioResumed) {
    effects.resumeAudio(); // pointer-lock click is the user gesture for WebAudio
    audioResumed = true;
  }
  lockHint.classList.toggle('hidden', locked || inventory.open);
  if (locked && inventory.open) inventory.close(); // clicking back into the game closes inventory
};
inventory.onOpen = () => {
  input.releaseLock();
  interaction.setPaused(true);
  lockHint.classList.add('hidden');
};
inventory.onClose = () => {
  interaction.setPaused(false);
  // Pointer is still unlocked after closing; prompt the user to click back in.
  if (!input.locked) lockHint.classList.remove('hidden');
};

input.onWheel = (dir) => hotbar.cycle(dir);
input.onMouseDown = (button) => {
  if (button === 2) interaction.tryPlace();
};
input.onKeyPress = (code) => {
  if (code === 'KeyE') {
    inventory.toggle();
    return;
  }
  if (code === 'KeyF') {
    player.toggleMode();
    return;
  }
  if (code === 'KeyM') {
    muted = !muted;
    effects.setMuted(muted);
    return;
  }
  if (code === 'KeyT') {
    materials.shared.uAtlas.value = textures.cycle().getAtlas(); // instant, no re-mesh
    return;
  }
  if (code === 'KeyG') {
    applyPreset(nextPreset(settings.preset));
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
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accumulator = 0; // drop backlog after a stall
  }

  // Advance the day/night cycle (hold N to fast-forward).
  const tScale = input.isDown('KeyN') ? DAY_FF_MULT : 1;
  dayNight.update(frameDt * tScale);

  // Per-frame (responsive): camera, aim, streaming, render.
  const alpha = physicsStarted ? accumulator / FIXED_DT : 0;
  player.applyToCamera(camera, alpha);
  camera.getWorldDirection(tmpDir);
  interaction.updateAim(camera.position, tmpDir); // aim BEFORE view-bob so the crosshair is steady
  effects.update(frameDt, camera); // sets sprint FOV + applies view-bob to camera

  sky.update(camera.position, dayNight);
  sunMoon.update(camera.position, dayNight);
  clouds.update(camera.position, dayNight, frameDt);
  stars.update(camera.position, dayNight);

  materials.shared.uTime.value = now / 1000;
  materials.shared.uDayFactor.value = dayNight.dayFactor;
  materials.shared.uMoonFactor.value = dayNight.moonFactor;
  materials.shared.uNightAmbient.value = dayNight.nightAmbient;
  materials.shared.uFogColor.value.copy(dayNight.fogColor);
  materials.shared.uFogDensity.value = dayNight.fogDensity;
  materials.shared.uSunDir.value.copy(dayNight.sunDir);

  // Underwater (Phase 5/7b): when the eye is in a water block, override the shared
  // fog (DayNight rewrote it just above, so this auto-clears on surfacing), ramp
  // color/density by how deep the eye is, drive the in-shader absorption/caustics,
  // and fade in the tint overlay + post wobble. Reflections are disabled below.
  const submerged =
    world.getBlockWorld(
      Math.floor(camera.position.x),
      Math.floor(camera.position.y),
      Math.floor(camera.position.z),
    ) === Block.WATER;
  let uwDepth = 0;
  if (submerged) {
    uwDepth = Math.min(Math.max((WATER_SURFACE_Y - camera.position.y) / UNDERWATER_MAX_DEPTH, 0), 1);
    const shallow = settings.usePost ? uwFogColorLinear : uwFogColorSRGB;
    const deep = settings.usePost ? uwDeepColorLinear : uwDeepColorSRGB;
    materials.shared.uFogColor.value.copy(shallow).lerp(deep, uwDepth);
    materials.shared.uFogDensity.value =
      UNDERWATER_FOG_DENSITY + (UNDERWATER_DEEP_FOG_DENSITY - UNDERWATER_FOG_DENSITY) * uwDepth;
  }
  materials.shared.uUnderwater.value = submerged ? 1 : 0;
  materials.shared.uUnderwaterDepth.value = uwDepth;
  underwaterOverlay.setActive(submerged);
  composer.setUnderwater(submerged ? 1 : 0, now / 1000);
  underwaterParticles.update(frameDt, camera.position, submerged);

  chunkManager.update(frameDt, player.pos);

  // Phase 4b (Cinematic): sun-depth pass first so reflected terrain is shadowed
  // too, then the planar water reflection. Both restore render target/override.
  if (settings.shadows) shadowMapper.render(renderer, scene, camera.position, dayNight);
  if (settings.waterReflections) planarReflection.render(renderer, scene, camera);

  if (settings.usePost) {
    if (settings.godRays) {
      const vis = sunMoon.sunScreenPos(camera, tmpSunUv) && dayNight.sunAboveHorizon;
      composer.updateGodRays(tmpSunUv, vis);
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
