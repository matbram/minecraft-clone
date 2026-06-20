// Entry point: wire renderer, world, generation, meshing, and the fly camera,
// then run the throttled render loop.

import * as THREE from 'three';
import { DEFAULT_SEED } from './core/constants';
import { surfaceHeight } from './core/WorldGen';
import { World } from './world/World';
import { GenScheduler } from './gen/GenScheduler';
import { buildAtlas } from './render/atlas';
import { createMaterials } from './render/materials';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ChunkManager } from './game/ChunkManager';
import { FlyCamera } from './player/Camera';

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
scene.background = skyColor;

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

// --- assets + systems ------------------------------------------------------
const atlas = buildAtlas();
const materials = createMaterials(atlas, skyColor);

const world = new World(seed);
world.load();

const scheduler = new GenScheduler(seed);
const chunkRenderer = new ChunkRenderer(scene, materials);
const chunkManager = new ChunkManager(world, scheduler, chunkRenderer);

const flyCam = new FlyCamera(camera, renderer.domElement);

// Spawn comfortably above the terrain at the origin.
const spawnX = 8;
const spawnZ = 8;
const spawnY = surfaceHeight(spawnX, spawnZ, seed) + 6;
flyCam.setPosition(spawnX, spawnY, spawnZ);
flyCam.pitch = -0.35;

// --- UI glue ---------------------------------------------------------------
const lockHint = document.getElementById('lock-hint')!;
flyCam.onLockChange = (locked) => {
  lockHint.classList.toggle('hidden', locked);
};
const hud = document.getElementById('hud')!;

// --- resize ----------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  flyCam.update(dt);
  chunkManager.update(dt, camera.position);

  materials.shared.uTime.value = now / 1000;

  renderer.render(scene, camera);

  // HUD (throttled to ~5 Hz).
  if (dt > 0) fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;
  hudAccum += dt;
  if (hudAccum > 0.2) {
    hudAccum = 0;
    const p = camera.position;
    hud.textContent =
      `fps ${fpsSmooth.toFixed(0)}\n` +
      `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `chunk ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}\n` +
      `loaded ${chunkManager.loadedCount}  meshQ ${chunkManager.meshQueueLength}\n` +
      `seed ${seed}  workers ${scheduler.poolSize}`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
