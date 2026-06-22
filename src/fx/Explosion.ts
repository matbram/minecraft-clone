// Phase 15/15.1: the gameplay payload of a rocket detonation — carve a permanent crater,
// shove + damage the player and creatures, and drop temporary fire — then hand off to
// Effects for the cinematic FX. Kept separate from Effects (which only touches camera +
// audio) because this DOES mutate the world / player / survival.
//
// `power` (ammo type × Tunables.explosionPower) scales every quantity. The crater uses a
// BULK edit (World.bulkEdit) so even a huge "Nuke" carves instantly and relights over a
// few frames instead of doing a synchronous light BFS per block (which would freeze).

import * as THREE from 'three';
import { Block, IS_SOLID } from '../core/BlockTypes';
import {
  CY,
  EYE_HEIGHT,
  EXPLOSION_CRATER_R,
  EXPLOSION_CRATER_INNER,
  EXPLOSION_CRATER_MAX,
  EXPLOSION_DAMAGE_R,
  EXPLOSION_DAMAGE_INNER,
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_KNOCKBACK_R,
  EXPLOSION_KNOCKBACK,
  EXPLOSION_KNOCKBACK_MAX,
  EXPLOSION_KNOCKBACK_UP,
  EXPLOSION_POWER_MAX,
  EXPLOSION_FIRE_COUNT,
  FIRE_LIFETIME_MIN,
  FIRE_LIFETIME_MAX,
} from '../core/constants';
import type { World } from '../world/World';
import type { Player } from '../player/Player';
import type { Survival } from '../player/Survival';
import type { Fauna } from '../world/Fauna';
import type { Effects } from './Effects';
import type { Settings } from '../ui/Settings';

interface FireCell {
  x: number;
  y: number;
  z: number;
  expire: number; // value of `clock` after which it reverts to AIR
}

type Cell = { x: number; y: number; z: number; type: Block };

export class Explosion {
  private readonly fires: FireCell[] = [];
  private clock = 0;

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly survival: Survival,
    private readonly fauna: Fauna,
    private readonly effects: Effects,
    private readonly prefs: Settings,
  ) {}

  detonate(center: THREE.Vector3, power = 1): void {
    const p = Math.min(EXPLOSION_POWER_MAX, Math.max(0.25, power)); // damage/knockback/FX scale
    const craterR = Math.min(EXPLOSION_CRATER_MAX, EXPLOSION_CRATER_R * power); // crater has its own cap
    const inner = Math.min(craterR - 1, EXPLOSION_CRATER_INNER * power);

    // Crater (bulk, permanent) — instant carve, relight/remesh spread over frames.
    this.world.bulkEdit(this.buildCraterCells(center, craterR, inner), true);
    // Temporary fire scattered on the new crater surfaces (not persisted -> regenerates
    // clean on reload; reverted on a timer here).
    const fireCells = this.buildFireCells(center, craterR, Math.min(40, Math.round(EXPLOSION_FIRE_COUNT * p)));
    if (fireCells.length) this.world.bulkEdit(fireCells, false);

    // Force + damage. Knockback always; player health only in Survival.
    const knock = Math.min(EXPLOSION_KNOCKBACK_MAX, EXPLOSION_KNOCKBACK * Math.sqrt(p));
    this.applyForce(center, p, knock);
    this.fauna.explode(center, EXPLOSION_DAMAGE_R * p, EXPLOSION_MAX_DAMAGE * p, knock);

    const dx = this.player.pos.x - center.x;
    const dy = this.player.pos.y + EYE_HEIGHT - center.y;
    const dz = this.player.pos.z - center.z;
    this.effects.onExplosion(center, Math.hypot(dx, dy, dz), power);
  }

  // Expire temporary fire blocks (revert to AIR once their lifetime is up).
  update(dt: number): void {
    if (this.fires.length === 0) return;
    this.clock += dt;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (this.clock < f.expire) continue;
      if (this.world.getBlockWorld(f.x, f.y, f.z) === Block.FIRE) {
        this.world.editBlock(f.x, f.y, f.z, Block.AIR);
      }
      this.fires.splice(i, 1);
    }
  }

  // Bowl-shaped sphere of AIR cells (full within `inner`, thinning to `R`). Built in
  // ascending Y per column so bulkEdit removes each column bottom-up (one height rescan).
  private buildCraterCells(center: THREE.Vector3, R: number, inner: number): Cell[] {
    const cells: Cell[] = [];
    const x0 = Math.floor(center.x - R);
    const x1 = Math.ceil(center.x + R);
    const y0 = Math.max(0, Math.floor(center.y - R));
    const y1 = Math.min(CY - 1, Math.ceil(center.y + R));
    const z0 = Math.floor(center.z - R);
    const z1 = Math.ceil(center.z + R);
    const R2 = R * R;
    const inner2 = inner * inner;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const dx = x + 0.5 - center.x;
          const dy = y + 0.5 - center.y;
          const dz = z + 0.5 - center.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R2) continue;
          const b = this.world.getBlockWorld(x, y, z);
          if (b === Block.AIR || b === Block.WATER || b === Block.BEDROCK) continue;
          if (d2 > inner2) {
            const d = Math.sqrt(d2);
            if (Math.random() > (R - d) / (R - inner)) continue; // thinned edge
          }
          cells.push({ x, y, z, type: Block.AIR });
        }
      }
    }
    return cells;
  }

  // A few FIRE cells sitting on solid surfaces inside the (already carved) crater.
  private buildFireCells(center: THREE.Vector3, R: number, count: number): Cell[] {
    const out: Cell[] = [];
    for (let i = 0; i < count; i++) {
      const ox = Math.floor(center.x + (Math.random() - 0.5) * 2 * R);
      const oz = Math.floor(center.z + (Math.random() - 0.5) * 2 * R);
      const top = Math.min(CY - 2, Math.ceil(center.y + R));
      const bottom = Math.max(0, Math.floor(center.y - R));
      for (let y = top; y >= bottom; y--) {
        if (!IS_SOLID[this.world.getBlockWorld(ox, y, oz)]) continue;
        if (this.world.getBlockWorld(ox, y + 1, oz) !== Block.AIR) break;
        out.push({ x: ox, y: y + 1, z: oz, type: Block.FIRE });
        this.fires.push({
          x: ox,
          y: y + 1,
          z: oz,
          expire: this.clock + FIRE_LIFETIME_MIN + Math.random() * (FIRE_LIFETIME_MAX - FIRE_LIFETIME_MIN),
        });
        break;
      }
    }
    return out;
  }

  // Radial impulse + damage to the player. Knockback always; health only in Survival.
  private applyForce(center: THREE.Vector3, p: number, knock: number): void {
    const px = this.player.pos.x;
    const py = this.player.pos.y + 0.9; // ~body center
    const pz = this.player.pos.z;
    const dx = px - center.x;
    const dy = py - center.y;
    const dz = pz - center.z;
    const d = Math.hypot(dx, dy, dz);

    const knockR = EXPLOSION_KNOCKBACK_R * p;
    if (d < knockR) {
      const fall = 1 - d / knockR;
      const force = knock * fall * fall; // ~1/r^2
      if (d < 1e-3) {
        this.player.vel.y += force; // standing on it -> straight up
      } else {
        const inv = 1 / d;
        this.player.vel.x += dx * inv * force;
        this.player.vel.y += dy * inv * force + force * EXPLOSION_KNOCKBACK_UP;
        this.player.vel.z += dz * inv * force;
      }
      this.player.onGround = false;
    }

    const dmgR = EXPLOSION_DAMAGE_R * p;
    if (this.prefs.data.survival && d < dmgR) {
      const innerR = EXPLOSION_DAMAGE_INNER * p;
      const maxDmg = EXPLOSION_MAX_DAMAGE * p;
      let dmg: number;
      if (d <= innerR) dmg = maxDmg;
      else dmg = maxDmg * (1 - (d - innerR) / (dmgR - innerR));
      this.survival.health = Math.max(0, this.survival.health - Math.max(0, dmg));
      // survival.tick (each fixed step while locked+survival) flips `dead` -> respawn.
    }
  }
}
