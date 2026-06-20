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

// --- renderer + scene ------------------------------------------------------
const app = document.getElementById('app')!;
const skyColor = new THREE.Color(0x8fc6f0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(skyColor, 1);
app.appendChild(renderer.domElement);

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
