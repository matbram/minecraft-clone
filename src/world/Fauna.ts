// Phase 12c — cosmetic wandering fauna. Pooled, biome-gated creatures that walk the
// terrain (or swim in water) near the player and despawn when far. Mirrors the ItemDrops
// pattern: a fixed pool of THREE.Mesh slots, geometry cached per species, per-slot material
// tinted by baked world light. Creatures are PURELY visual — the world/physics never see
// them, so there's no collision and nothing to persist.

import * as THREE from 'three';
import { Block, IS_SOLID } from '../core/BlockTypes';
import { SEA_LEVEL, CX, CZ, CY, colIdx, mod, worldToChunk } from '../core/constants';
import { Biome } from '../core/biome';
import type { World } from '../world/World';

const MAX = 56; // total creature pool
const SPAWN_MIN = 22; // don't spawn right on top of the player
const SPAWN_MAX = 96; // ~ render distance
const DESPAWN = 120;
const SPAWN_INTERVAL = 0.4; // seconds between spawn attempts
const SPAWN_TRIES = 5; // candidate columns per attempt

type RGB = [number, number, number];
type Arch = 'quad' | 'fish';

interface Species {
  arch: Arch;
  body: RGB;
  accent: RGB; // legs/head shade (quad) or fin (fish)
  scale: number;
  speed: number; // blocks/sec
  biomes: Biome[];
}

// A believable handful, mapped to biomes. Colours are multiplied by world light at runtime.
const SPECIES: Species[] = [
  { arch: 'quad', body: [0.45, 0.3, 0.22], accent: [0.9, 0.9, 0.86], scale: 1.0, speed: 1.3, biomes: [Biome.PLAINS, Biome.FOREST, Biome.SAVANNA] }, // cow
  { arch: 'quad', body: [0.92, 0.92, 0.88], accent: [0.85, 0.72, 0.6], scale: 0.95, speed: 1.1, biomes: [Biome.PLAINS, Biome.FOREST, Biome.TAIGA] }, // sheep
  { arch: 'quad', body: [0.88, 0.6, 0.62], accent: [0.78, 0.5, 0.52], scale: 0.85, speed: 1.2, biomes: [Biome.PLAINS, Biome.FOREST, Biome.SWAMP, Biome.JUNGLE] }, // pig
  { arch: 'quad', body: [0.95, 0.95, 0.92], accent: [0.85, 0.4, 0.2], scale: 0.5, speed: 1.4, biomes: [Biome.PLAINS, Biome.FOREST, Biome.JUNGLE] }, // chicken
  { arch: 'quad', body: [0.55, 0.42, 0.3], accent: [0.5, 0.38, 0.28], scale: 0.45, speed: 1.6, biomes: [Biome.PLAINS, Biome.FOREST, Biome.MOUNTAIN, Biome.DESERT] }, // rabbit
  { arch: 'quad', body: [0.96, 0.97, 1.0], accent: [0.9, 0.92, 0.96], scale: 0.45, speed: 1.6, biomes: [Biome.SNOWY_TUNDRA] }, // snow rabbit
  { arch: 'quad', body: [0.55, 0.56, 0.58], accent: [0.4, 0.41, 0.43], scale: 0.85, speed: 1.8, biomes: [Biome.TAIGA, Biome.FOREST, Biome.SNOWY_TUNDRA] }, // wolf
  { arch: 'quad', body: [0.8, 0.42, 0.18], accent: [0.95, 0.95, 0.9], scale: 0.6, speed: 1.9, biomes: [Biome.TAIGA, Biome.FOREST] }, // fox
  { arch: 'quad', body: [0.82, 0.68, 0.42], accent: [0.72, 0.58, 0.34], scale: 1.35, speed: 1.1, biomes: [Biome.DESERT, Biome.BADLANDS] }, // camel
  { arch: 'quad', body: [0.85, 0.85, 0.82], accent: [0.5, 0.45, 0.4], scale: 0.85, speed: 1.4, biomes: [Biome.MOUNTAIN] }, // goat
  { arch: 'fish', body: [0.4, 0.6, 0.85], accent: [0.85, 0.88, 0.95], scale: 0.6, speed: 2.0, biomes: [Biome.OCEAN, Biome.DEEP_OCEAN, Biome.RIVER, Biome.FROZEN_OCEAN] }, // fish
];

function addBox(
  P: number[], N: number[], C: number[], I: number[],
  cx: number, cy: number, cz: number, w: number, h: number, l: number, col: RGB,
): void {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(cx, cy, cz);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const base = P.length / 3;
  for (let i = 0; i < pos.count; i++) {
    P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    C.push(col[0], col[1], col[2]);
  }
  const idx = g.index!;
  for (let i = 0; i < idx.count; i++) I.push(base + idx.getX(i));
  g.dispose();
}

// Build a merged, vertex-coloured box model. Origin at the feet (y=0), facing +Z.
function buildGeometry(spec: Species): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  const s = spec.scale;
  if (spec.arch === 'fish') {
    addBox(P, N, C, I, 0, 0, 0, 0.3 * s, 0.3 * s, 0.7 * s, spec.body); // body
    addBox(P, N, C, I, 0, 0, -0.5 * s, 0.05 * s, 0.35 * s, 0.25 * s, spec.accent); // tail fin
  } else {
    const legH = 0.4 * s;
    const bw = 0.5 * s;
    const bh = 0.45 * s;
    const bl = 0.85 * s;
    const cyBody = legH + bh / 2;
    addBox(P, N, C, I, 0, cyBody, 0, bw, bh, bl, spec.body); // body
    addBox(P, N, C, I, 0, cyBody + bh * 0.35, bl / 2 + 0.1 * s, bw * 0.7, bh * 0.7, 0.32 * s, spec.body); // head
    addBox(P, N, C, I, 0, cyBody, -bl / 2 - 0.04 * s, 0.06 * s, 0.18 * s, 0.18 * s, spec.accent); // tail
    const lw = 0.14 * s;
    const lx = bw / 2 - lw / 2;
    const lz = bl / 2 - lw;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        addBox(P, N, C, I, sx * lx, legH / 2, sz * lz, lw, legH, lw, spec.accent);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

interface Critter {
  active: boolean;
  spec: number;
  arch: Arch;
  pos: THREE.Vector3;
  heading: number;
  pitch: number; // fish only
  moving: boolean;
  timer: number;
  phase: number;
  mesh: THREE.Mesh;
}

export class Fauna {
  private readonly slots: Critter[] = [];
  private readonly geomCache = new Map<number, THREE.BufferGeometry>();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly world: World;
  private spawnTimer = 1;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    for (let i = 0; i < MAX; i++) {
      const mesh = new THREE.Mesh(undefined, this.mat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        active: false, spec: 0, arch: 'quad', pos: new THREE.Vector3(),
        heading: 0, pitch: 0, moving: false, timer: 0, phase: 0, mesh,
      });
    }
  }

  private geomFor(spec: number): THREE.BufferGeometry {
    let g = this.geomCache.get(spec);
    if (!g) {
      g = buildGeometry(SPECIES[spec]);
      this.geomCache.set(spec, g);
    }
    return g;
  }

  // First solid block top at/below a world Y (scanning a few blocks). -1 if none.
  private groundTop(wx: number, wy: number, wz: number): number {
    for (let y = Math.min(CY - 1, wy + 1); y >= wy - 4 && y >= 0; y--) {
      if (IS_SOLID[this.world.getBlockWorld(wx, y, wz)]) return y + 1;
    }
    return -1;
  }

  private isWaterAt(wx: number, wy: number, wz: number): boolean {
    return this.world.getBlockWorld(wx, Math.floor(wy), wz) === Block.WATER;
  }

  private trySpawn(player: THREE.Vector3): void {
    let landCount = 0;
    let fishCount = 0;
    for (const s of this.slots) if (s.active) (s.arch === 'fish' ? fishCount++ : landCount++);

    for (let t = 0; t < SPAWN_TRIES; t++) {
      const slot = this.slots.find((s) => !s.active);
      if (!slot) return;
      const ang = Math.random() * Math.PI * 2;
      const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const wx = Math.floor(player.x + Math.cos(ang) * r);
      const wz = Math.floor(player.z + Math.sin(ang) * r);
      const chunk = this.world.getChunk(worldToChunk(wx), worldToChunk(wz));
      if (!chunk) continue;
      const lx = mod(wx, CX);
      const lz = mod(wz, CZ);
      const biome = chunk.getBiome(lx, lz) as Biome;
      const top = chunk.heightMap[colIdx(lx, lz)]; // 1 + topmost (incl. water)
      const water = chunk.getBlock(lx, top - 1, lz) === Block.WATER;

      // Pick a species valid for this biome + column type.
      const wantFish = water;
      const candidates: number[] = [];
      for (let i = 0; i < SPECIES.length; i++) {
        const sp = SPECIES[i];
        if ((sp.arch === 'fish') !== wantFish) continue;
        if (sp.biomes.includes(biome)) candidates.push(i);
      }
      if (candidates.length === 0) continue;
      if (wantFish && fishCount >= 20) continue;
      if (!wantFish && landCount >= MAX - 20) continue;
      const spec = candidates[(Math.random() * candidates.length) | 0];

      let y: number;
      if (wantFish) {
        // Somewhere in the water column (above the floor, below the surface).
        const floorY = this.groundTop(wx, SEA_LEVEL, wz);
        if (floorY < 0 || SEA_LEVEL - floorY < 3) continue;
        y = floorY + 1 + Math.random() * (SEA_LEVEL - 1 - floorY - 1);
        fishCount++;
      } else {
        const groundY = top; // surface block top
        if (groundY <= SEA_LEVEL) continue; // not dry land
        y = groundY;
        landCount++;
      }

      slot.active = true;
      slot.spec = spec;
      slot.arch = SPECIES[spec].arch;
      slot.pos.set(wx + 0.5, y, wz + 0.5);
      slot.heading = Math.random() * Math.PI * 2;
      slot.pitch = 0;
      slot.moving = true;
      slot.timer = 1 + Math.random() * 2;
      slot.phase = Math.random() * 10;
      slot.mesh.geometry = this.geomFor(spec);
      slot.mesh.visible = true;
    }
  }

  update(dt: number, player: THREE.Vector3, lightMul: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.trySpawn(player);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    for (const s of this.slots) {
      if (!s.active) continue;

      const dxp = s.pos.x - player.x;
      const dzp = s.pos.z - player.z;
      if (dxp * dxp + dzp * dzp > DESPAWN * DESPAWN) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }

      s.timer -= dt;
      if (s.timer <= 0) {
        s.moving = Math.random() < 0.7;
        if (s.moving) s.heading += (Math.random() - 0.5) * 1.5;
        s.timer = 1 + Math.random() * 2.5;
      }

      const spec = SPECIES[s.spec];
      const fwdX = Math.sin(s.heading);
      const fwdZ = Math.cos(s.heading);

      if (s.arch === 'fish') {
        // Swim in 3D; turn when the next cell isn't water; stay between floor and surface.
        const aheadX = s.pos.x + fwdX * 0.7;
        const aheadZ = s.pos.z + fwdZ * 0.7;
        const aheadY = s.pos.y + Math.sin(s.pitch) * 0.7;
        if (!this.isWaterAt(Math.floor(aheadX), aheadY, Math.floor(aheadZ))) {
          s.heading += 1.5 + Math.random();
          s.pitch = -s.pitch;
        } else if (s.moving) {
          s.pos.x = aheadX;
          s.pos.z = aheadZ;
          s.pos.y += Math.sin(s.pitch) * spec.speed * dt;
        }
        if (s.pos.y > SEA_LEVEL - 1.2) s.pitch = -Math.abs(s.pitch) - 0.05;
        else if (!this.isWaterAt(Math.floor(s.pos.x), s.pos.y - 0.6, Math.floor(s.pos.z))) s.pitch = Math.abs(s.pitch) + 0.05;
        s.pitch = Math.max(-0.5, Math.min(0.5, s.pitch));
        s.phase += dt * 6;
        s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
        s.mesh.rotation.set(s.pitch, s.heading, Math.sin(s.phase) * 0.15);
      } else {
        // Walk: probe the cell ahead; turn at walls, cliffs, and water.
        if (s.moving) {
          const nx = s.pos.x + fwdX * spec.speed * dt;
          const nz = s.pos.z + fwdZ * spec.speed * dt;
          const fx = Math.floor(nx + fwdX * 0.4);
          const fz = Math.floor(nz + fwdZ * 0.4);
          const footY = Math.floor(s.pos.y);
          const aheadBlock = this.world.getBlockWorld(fx, footY, fz);
          const stepUp = this.world.getBlockWorld(fx, footY + 1, fz);
          const groundAhead = this.groundTop(fx, footY, fz);
          if (aheadBlock === Block.WATER || groundAhead < 0 || Math.abs(groundAhead - s.pos.y) > 1.2 || (IS_SOLID[aheadBlock] && IS_SOLID[stepUp])) {
            s.heading += 1.6 + Math.random(); // turn away
          } else {
            s.pos.x = nx;
            s.pos.z = nz;
            const g = this.groundTop(Math.floor(nx), footY, Math.floor(nz));
            if (g >= 0) s.pos.y = g;
          }
          s.phase += dt * spec.speed * 4;
        }
        const bob = s.moving ? Math.sin(s.phase) * 0.04 : 0;
        s.mesh.position.set(s.pos.x, s.pos.y + bob, s.pos.z);
        s.mesh.rotation.set(0, s.heading, 0);
      }

      const b = this.world.brightnessAt(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z), lightMul);
      (s.mesh.material as THREE.MeshBasicMaterial).color.setScalar(Math.max(0.15, b));
    }
  }
}
