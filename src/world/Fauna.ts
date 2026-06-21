// Phase 12c/12d — wandering biome fauna. Pooled, biome-gated creatures that walk the
// terrain (with gravity — they fall off ledges) or swim in water near the player and
// despawn when far. Mirrors the ItemDrops pattern: a fixed pool of THREE.Mesh slots, one
// merged vertex-coloured box model per species (1 draw call each), per-slot material tinted
// by baked world light. Creatures are cosmetic (the world/physics never see them) but CAN
// be hit/killed via raycast from the player.

import * as THREE from 'three';
import { Block, IS_SOLID } from '../core/BlockTypes';
import { SEA_LEVEL, CX, CZ, CY, colIdx, mod, worldToChunk } from '../core/constants';
import { Biome } from '../core/biome';
import type { World } from '../world/World';

const MAX = 64; // total creature pool
const FISH_CAP = 28;
const SPAWN_MIN = 22;
const SPAWN_MAX = 96;
const DESPAWN = 120;
const SPAWN_INTERVAL = 0.4;
const SPAWN_TRIES = 4;
const GRAV = 20;

type RGB = [number, number, number];
type Arch = 'quad' | 'fish';
type Feature = 'none' | 'ears' | 'longears' | 'horns' | 'hump' | 'beak';

interface Species {
  arch: Arch;
  body: RGB;
  accent: RGB;
  scale: number;
  speed: number;
  health: number;
  feat: Feature;
  biomes: Biome[];
}

const SPECIES: Species[] = [
  { arch: 'quad', body: [0.42, 0.28, 0.2], accent: [0.92, 0.9, 0.86], scale: 1.0, speed: 1.3, health: 12, feat: 'horns', biomes: [Biome.PLAINS, Biome.FOREST, Biome.SAVANNA] }, // cow
  { arch: 'quad', body: [0.9, 0.9, 0.86], accent: [0.7, 0.6, 0.5], scale: 0.95, speed: 1.1, health: 10, feat: 'none', biomes: [Biome.PLAINS, Biome.FOREST, Biome.TAIGA] }, // sheep
  { arch: 'quad', body: [0.85, 0.58, 0.6], accent: [0.7, 0.45, 0.47], scale: 0.82, speed: 1.2, health: 10, feat: 'none', biomes: [Biome.PLAINS, Biome.FOREST, Biome.SWAMP, Biome.JUNGLE] }, // pig
  { arch: 'quad', body: [0.93, 0.93, 0.9], accent: [0.88, 0.45, 0.12], scale: 0.5, speed: 1.4, health: 4, feat: 'beak', biomes: [Biome.PLAINS, Biome.FOREST, Biome.JUNGLE] }, // chicken
  { arch: 'quad', body: [0.55, 0.42, 0.3], accent: [0.5, 0.38, 0.28], scale: 0.42, speed: 1.7, health: 4, feat: 'longears', biomes: [Biome.PLAINS, Biome.FOREST, Biome.MOUNTAIN, Biome.DESERT] }, // rabbit
  { arch: 'quad', body: [0.94, 0.95, 0.98], accent: [0.86, 0.88, 0.92], scale: 0.42, speed: 1.7, health: 4, feat: 'longears', biomes: [Biome.SNOWY_TUNDRA] }, // snow rabbit
  { arch: 'quad', body: [0.5, 0.51, 0.54], accent: [0.36, 0.37, 0.4], scale: 0.85, speed: 1.9, health: 10, feat: 'ears', biomes: [Biome.TAIGA, Biome.FOREST, Biome.SNOWY_TUNDRA] }, // wolf
  { arch: 'quad', body: [0.78, 0.4, 0.16], accent: [0.95, 0.95, 0.9], scale: 0.58, speed: 2.0, health: 6, feat: 'ears', biomes: [Biome.TAIGA, Biome.FOREST] }, // fox
  { arch: 'quad', body: [0.82, 0.68, 0.42], accent: [0.72, 0.58, 0.34], scale: 1.3, speed: 1.1, health: 14, feat: 'hump', biomes: [Biome.DESERT, Biome.BADLANDS] }, // camel
  { arch: 'quad', body: [0.84, 0.84, 0.8], accent: [0.55, 0.5, 0.42], scale: 0.85, speed: 1.4, health: 10, feat: 'horns', biomes: [Biome.MOUNTAIN] }, // goat
  { arch: 'fish', body: [0.35, 0.58, 0.85], accent: [0.85, 0.88, 0.95], scale: 0.6, speed: 2.2, health: 3, feat: 'none', biomes: [Biome.OCEAN, Biome.DEEP_OCEAN, Biome.RIVER, Biome.FROZEN_OCEAN] }, // fish
];
const EYE: RGB = [0.06, 0.06, 0.08];

// Append a box; bakes simple per-face shading (top brightest, bottom darkest, sides mid)
// into vertex colours so the unlit material still reads as 3D form.
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
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    let sh = 0.8; // left/right
    if (ny > 0.5) sh = 1.0;
    else if (ny < -0.5) sh = 0.55;
    else if (Math.abs(nz) > 0.5) sh = 0.88; // front/back
    N.push(nor.getX(i), ny, nz);
    C.push(col[0] * sh, col[1] * sh, col[2] * sh);
  }
  const idx = g.index!;
  for (let i = 0; i < idx.count; i++) I.push(base + idx.getX(i));
  g.dispose();
}

// Merged, vertex-coloured box model. Origin at the feet (y=0), facing +Z (head toward +Z).
function buildGeometry(spec: Species): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  const s = spec.scale;

  if (spec.arch === 'fish') {
    addBox(P, N, C, I, 0, 0, 0.05 * s, 0.32 * s, 0.34 * s, 0.7 * s, spec.body); // body
    addBox(P, N, C, I, 0, 0, -0.45 * s, 0.05 * s, 0.34 * s, 0.28 * s, spec.accent); // tail fin
    addBox(P, N, C, I, 0, 0.12 * s, 0.18 * s, 0.34 * s, 0.06 * s, 0.16 * s, spec.accent); // dorsal fin
    // eyes (both sides, near the front)
    addBox(P, N, C, I, 0.14 * s, 0.04 * s, 0.32 * s, 0.06 * s, 0.06 * s, 0.06 * s, EYE);
    addBox(P, N, C, I, -0.14 * s, 0.04 * s, 0.32 * s, 0.06 * s, 0.06 * s, 0.06 * s, EYE);
  } else {
    const legH = 0.4 * s;
    const bw = (spec.feat === 'none' && spec.scale > 0.9 ? 0.58 : 0.5) * s; // sheep a bit fluffier
    const bh = 0.45 * s;
    const bl = 0.85 * s;
    const cyBody = legH + bh / 2;
    addBox(P, N, C, I, 0, cyBody, 0, bw, bh, bl, spec.body); // body
    const hw = bw * 0.7;
    const hh = bh * 0.72;
    const hd = 0.34 * s;
    const hcy = cyBody + bh * 0.36;
    const hcz = bl / 2 + hd / 2;
    addBox(P, N, C, I, 0, hcy, hcz, hw, hh, hd, spec.body); // head
    addBox(P, N, C, I, 0, cyBody, -bl / 2 - 0.04 * s, 0.06 * s, 0.16 * s, 0.18 * s, spec.accent); // tail
    // legs
    const lw = 0.14 * s;
    const lx = bw / 2 - lw / 2;
    const lz = bl / 2 - lw;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        addBox(P, N, C, I, sx * lx, legH / 2, sz * lz, lw, legH, lw, spec.accent);
    // eyes on the head front
    const eyZ = hcz + hd / 2;
    const eyY = hcy + hh * 0.12;
    addBox(P, N, C, I, hw * 0.26, eyY, eyZ, 0.08 * s, 0.08 * s, 0.05 * s, EYE);
    addBox(P, N, C, I, -hw * 0.26, eyY, eyZ, 0.08 * s, 0.08 * s, 0.05 * s, EYE);
    // species features
    const topY = hcy + hh / 2;
    if (spec.feat === 'beak') {
      addBox(P, N, C, I, 0, hcy - hh * 0.05, eyZ + 0.04 * s, 0.12 * s, 0.08 * s, 0.12 * s, spec.accent);
    } else if (spec.feat === 'horns' || spec.feat === 'ears' || spec.feat === 'longears') {
      const isEar = spec.feat !== 'horns';
      const eh = (spec.feat === 'longears' ? 0.4 : isEar ? 0.16 : 0.14) * s;
      const ec: RGB = isEar ? spec.body : [0.85, 0.82, 0.72];
      for (const sx of [-1, 1])
        addBox(P, N, C, I, sx * hw * 0.32, topY + eh / 2, hcz - 0.02 * s, 0.09 * s, eh, 0.09 * s, ec);
    } else if (spec.feat === 'hump') {
      addBox(P, N, C, I, 0, cyBody + bh * 0.55, 0, bw * 0.7, bh * 0.5, bl * 0.45, spec.body);
    }
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
  vy: number;
  onGround: boolean;
  heading: number;
  pitch: number;
  moving: boolean;
  flee: number;
  health: number;
  timer: number;
  phase: number;
  mesh: THREE.Mesh;
}

export interface HitResult {
  killed: boolean;
  pos: THREE.Vector3;
  color: THREE.Color;
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
        active: false, spec: 0, arch: 'quad', pos: new THREE.Vector3(), vy: 0, onGround: false,
        heading: 0, pitch: 0, moving: false, flee: 0, health: 0, timer: 0, phase: 0, mesh,
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

  private isWaterAt(wx: number, wy: number, wz: number): boolean {
    return this.world.getBlockWorld(wx, Math.floor(wy), wz) === Block.WATER;
  }

  // Real ground surface in a column: scan down past non-solid (plants/leaves/air) to the
  // first solid; returns its top Y, or -1. `tree` flags a LOG surface (don't spawn there).
  private groundSurface(wx: number, wz: number, fromY: number): { y: number; tree: boolean } {
    for (let y = Math.min(CY - 1, fromY); y >= 0; y--) {
      const b = this.world.getBlockWorld(wx, y, wz);
      if (IS_SOLID[b]) return { y: y + 1, tree: b === Block.LOG };
    }
    return { y: -1, tree: false };
  }

  private freeSlot(): Critter | undefined {
    return this.slots.find((s) => !s.active);
  }

  private spawnOne(slot: Critter, spec: number, x: number, y: number, z: number, heading: number): void {
    slot.active = true;
    slot.spec = spec;
    slot.arch = SPECIES[spec].arch;
    slot.pos.set(x, y, z);
    slot.vy = 0;
    slot.onGround = false;
    slot.heading = heading;
    slot.pitch = 0;
    slot.moving = true;
    slot.flee = 0;
    slot.health = SPECIES[spec].health;
    slot.timer = 1 + Math.random() * 2;
    slot.phase = Math.random() * 10;
    slot.mesh.geometry = this.geomFor(spec);
    slot.mesh.visible = true;
  }

  private trySpawn(player: THREE.Vector3): void {
    let fish = 0;
    let land = 0;
    for (const s of this.slots) if (s.active) (s.arch === 'fish' ? fish++ : land++);

    for (let t = 0; t < SPAWN_TRIES; t++) {
      const slot = this.freeSlot();
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
      const top = chunk.heightMap[colIdx(lx, lz)];
      const water = chunk.getBlock(lx, top - 1, lz) === Block.WATER;

      const candidates: number[] = [];
      for (let i = 0; i < SPECIES.length; i++) {
        const sp = SPECIES[i];
        if ((sp.arch === 'fish') !== water) continue;
        if (sp.biomes.includes(biome)) candidates.push(i);
      }
      if (candidates.length === 0) continue;
      const spec = candidates[(Math.random() * candidates.length) | 0];

      if (water) {
        if (fish >= FISH_CAP) continue;
        const ground = this.groundSurface(wx, wz, SEA_LEVEL);
        if (ground.y < 0 || SEA_LEVEL - ground.y < 3) continue;
        // Spawn a small school sharing a heading.
        const heading = Math.random() * Math.PI * 2;
        const n = Math.min(FISH_CAP - fish, 3 + (Math.random() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const sl = k === 0 ? slot : this.freeSlot();
          if (!sl) break;
          const fy = ground.y + 1 + Math.random() * (SEA_LEVEL - 1 - ground.y - 1);
          this.spawnOne(sl, spec, wx + 0.5 + (Math.random() - 0.5) * 4, fy, wz + 0.5 + (Math.random() - 0.5) * 4, heading + (Math.random() - 0.5) * 0.4);
          fish++;
        }
      } else {
        if (land >= MAX - FISH_CAP) continue;
        const ground = this.groundSurface(wx, wz, top);
        if (ground.y <= SEA_LEVEL || ground.tree) continue; // dry land, not a tree top
        this.spawnOne(slot, spec, wx + 0.5, ground.y, wz + 0.5, Math.random() * Math.PI * 2);
        land++;
      }
    }
  }

  // Nearest creature struck by a ray (player aim). Returns its slot index + distance.
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { idx: number; dist: number } | null {
    let bestIdx = -1;
    let bestT = maxDist;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const sp = SPECIES[s.spec];
      const r = 0.6 * sp.scale + 0.1;
      const ox = s.pos.x - o.x;
      const oy = s.pos.y + 0.4 * sp.scale - o.y;
      const oz = s.pos.z - o.z;
      const tca = ox * d.x + oy * d.y + oz * d.z;
      if (tca < 0) continue;
      const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
      if (d2 > r * r) continue;
      const t = tca - Math.sqrt(r * r - d2);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? { idx: bestIdx, dist: bestT } : null;
  }

  // Damage a creature; knockback + flee. Returns FX info (and whether it died).
  hit(idx: number, from: THREE.Vector3, dmg: number): HitResult | null {
    const s = this.slots[idx];
    if (!s || !s.active) return null;
    const sp = SPECIES[s.spec];
    s.health -= dmg;
    s.heading = Math.atan2(s.pos.x - from.x, s.pos.z - from.z); // face away
    s.flee = 4;
    s.moving = true;
    if (s.arch !== 'fish') {
      s.vy = 4;
      s.onGround = false;
    }
    const pos = new THREE.Vector3(s.pos.x, s.pos.y + 0.4 * sp.scale, s.pos.z);
    const color = new THREE.Color(sp.body[0], sp.body[1], sp.body[2]);
    if (s.health <= 0) {
      s.active = false;
      s.mesh.visible = false;
      return { killed: true, pos, color };
    }
    return { killed: false, pos, color };
  }

  update(dt: number, player: THREE.Vector3, lightMul: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.trySpawn(player);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    for (const s of this.slots) {
      if (!s.active) continue;
      const sp = SPECIES[s.spec];

      const dxp = s.pos.x - player.x;
      const dzp = s.pos.z - player.z;
      if (dxp * dxp + dzp * dzp > DESPAWN * DESPAWN || s.pos.y < -32) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }

      if (s.flee > 0) s.flee -= dt;
      const fleeing = s.flee > 0;

      if (s.arch === 'fish') {
        const fwdX = Math.sin(s.heading);
        const fwdZ = Math.cos(s.heading);
        const sp2 = sp.speed * (fleeing ? 1.8 : 1);
        const aheadX = s.pos.x + fwdX * 0.7;
        const aheadZ = s.pos.z + fwdZ * 0.7;
        if (!this.isWaterAt(Math.floor(aheadX), s.pos.y, Math.floor(aheadZ))) {
          s.heading += 1.5 + Math.random();
          s.pitch = -s.pitch;
        } else if (s.moving) {
          s.pos.x += fwdX * sp2 * dt;
          s.pos.z += fwdZ * sp2 * dt;
          s.pos.y += Math.sin(s.pitch) * sp2 * dt;
        }
        if (s.pos.y > SEA_LEVEL - 1.2) s.pitch = -Math.abs(s.pitch) - 0.05;
        else if (!this.isWaterAt(Math.floor(s.pos.x), s.pos.y - 0.6, Math.floor(s.pos.z))) s.pitch = Math.abs(s.pitch) + 0.05;
        s.pitch = Math.max(-0.5, Math.min(0.5, s.pitch));
        s.phase += dt * 6;
        s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
        s.mesh.rotation.set(s.pitch, s.heading, Math.sin(s.phase) * 0.18);
      } else {
        // Gravity + ground collision (feet at pos.y).
        s.vy -= GRAV * dt;
        let ny = s.pos.y + s.vy * dt;
        const fx = Math.floor(s.pos.x);
        const fz = Math.floor(s.pos.z);
        if (s.vy <= 0) {
          const by = Math.floor(ny - 0.02);
          if (IS_SOLID[this.world.getBlockWorld(fx, by, fz)]) {
            ny = by + 1;
            s.vy = 0;
            s.onGround = true;
          } else s.onGround = false;
        } else s.onGround = false;
        s.pos.y = ny;

        if (s.onGround) {
          s.timer -= dt;
          if (s.timer <= 0 && !fleeing) {
            s.moving = Math.random() < 0.7;
            if (s.moving) s.heading += (Math.random() - 0.5) * 1.6;
            s.timer = 1 + Math.random() * 2.5;
          }
          if (fleeing) s.moving = true;
          if (s.moving) {
            const spd = sp.speed * (fleeing ? 2.2 : 1);
            const hX = Math.sin(s.heading);
            const hZ = Math.cos(s.heading);
            const nx = s.pos.x + hX * spd * dt;
            const nz = s.pos.z + hZ * spd * dt;
            const ax = Math.floor(nx + hX * 0.3);
            const az = Math.floor(nz + hZ * 0.3);
            const footY = Math.floor(s.pos.y);
            if (IS_SOLID[this.world.getBlockWorld(ax, footY, az)]) {
              if (!IS_SOLID[this.world.getBlockWorld(ax, footY + 1, az)]) {
                s.pos.x = nx;
                s.pos.z = nz;
                s.pos.y = footY + 1; // step up
              } else {
                s.heading += 1.6 + Math.random(); // wall -> turn
              }
            } else {
              s.pos.x = nx; // walk (may walk off a ledge -> falls via gravity)
              s.pos.z = nz;
            }
            s.phase += dt * spd * 4;
          }
        }
        const bob = s.onGround && s.moving ? Math.sin(s.phase) * 0.05 : 0;
        s.mesh.position.set(s.pos.x, s.pos.y + bob, s.pos.z);
        s.mesh.rotation.set(0, s.heading, 0);
      }

      const b = this.world.brightnessAt(Math.floor(s.pos.x), Math.floor(s.pos.y + 0.3), Math.floor(s.pos.z), lightMul);
      (s.mesh.material as THREE.MeshBasicMaterial).color.setScalar(Math.max(0.2, Math.min(0.8, b)));
    }
  }
}
