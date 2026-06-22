// Phase 15: the gameplay payload of a rocket detonation — carve a permanent crater,
// shove + damage the player and creatures, and drop temporary fire — then hand off to
// Effects for the cinematic FX. Kept separate from Effects (which only ever touches the
// camera + audio) because this DOES mutate the world / player / survival.
//
// Falloff is ~1/r^2 (squared linear) capped at the center. Knockback always applies;
// player HEALTH damage only in Survival (matches the rest of the survival gating).

import * as THREE from 'three';
import { Block, IS_SOLID } from '../core/BlockTypes';
import {
  CY,
  EYE_HEIGHT,
  EXPLOSION_CRATER_R,
  EXPLOSION_CRATER_INNER,
  EXPLOSION_DAMAGE_R,
  EXPLOSION_DAMAGE_INNER,
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_KNOCKBACK_R,
  EXPLOSION_KNOCKBACK,
  EXPLOSION_KNOCKBACK_UP,
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

  detonate(center: THREE.Vector3): void {
    this.carveCrater(center);
    this.applyForce(center);
    this.fauna.explode(center, EXPLOSION_DAMAGE_R, EXPLOSION_MAX_DAMAGE, EXPLOSION_KNOCKBACK);
    this.placeFires(center);

    const dx = this.player.pos.x - center.x;
    const dy = this.player.pos.y + EYE_HEIGHT - center.y;
    const dz = this.player.pos.z - center.z;
    this.effects.onExplosion(center, Math.hypot(dx, dy, dz));
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

  // Permanent bowl-shaped crater: full removal within the inner core, probabilistically
  // thinning out to the edge. Skips bedrock + water (and air). Cross-chunk safe.
  private carveCrater(center: THREE.Vector3): void {
    const R = EXPLOSION_CRATER_R;
    const inner = EXPLOSION_CRATER_INNER;
    const x0 = Math.floor(center.x - R);
    const x1 = Math.ceil(center.x + R);
    const y0 = Math.max(0, Math.floor(center.y - R));
    const y1 = Math.min(CY - 1, Math.ceil(center.y + R));
    const z0 = Math.floor(center.z - R);
    const z1 = Math.ceil(center.z + R);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const dx = x + 0.5 - center.x;
          const dy = y + 0.5 - center.y;
          const dz = z + 0.5 - center.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R * R) continue;
          const b = this.world.getBlockWorld(x, y, z);
          if (b === Block.AIR || b === Block.WATER || b === Block.BEDROCK) continue;
          if (d2 > inner * inner) {
            const d = Math.sqrt(d2);
            if (Math.random() > (R - d) / (R - inner)) continue; // thinned edge
          }
          this.world.editBlock(x, y, z, Block.AIR);
        }
      }
    }
  }

  // Radial impulse + damage to the player. Knockback always; health only in Survival.
  private applyForce(center: THREE.Vector3): void {
    const px = this.player.pos.x;
    const py = this.player.pos.y + 0.9; // ~body center
    const pz = this.player.pos.z;
    const dx = px - center.x;
    const dy = py - center.y;
    const dz = pz - center.z;
    const d = Math.hypot(dx, dy, dz);

    if (d < EXPLOSION_KNOCKBACK_R) {
      const fall = 1 - d / EXPLOSION_KNOCKBACK_R;
      const force = EXPLOSION_KNOCKBACK * fall * fall; // ~1/r^2
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

    if (this.prefs.data.survival && d < EXPLOSION_DAMAGE_R) {
      let dmg: number;
      if (d <= EXPLOSION_DAMAGE_INNER) {
        dmg = EXPLOSION_MAX_DAMAGE;
      } else {
        dmg = EXPLOSION_MAX_DAMAGE * (1 - (d - EXPLOSION_DAMAGE_INNER) / (EXPLOSION_DAMAGE_R - EXPLOSION_DAMAGE_INNER));
      }
      this.survival.health = Math.max(0, this.survival.health - Math.max(0, dmg));
      // survival.tick (runs each fixed step while locked+survival) flips `dead`->respawn.
    }
  }

  // Scatter a few temporary, light-emitting FIRE blocks on solid surfaces in the crater.
  private placeFires(center: THREE.Vector3): void {
    const R = EXPLOSION_CRATER_R;
    for (let i = 0; i < EXPLOSION_FIRE_COUNT; i++) {
      const ox = Math.floor(center.x + (Math.random() - 0.5) * 2 * R);
      const oz = Math.floor(center.z + (Math.random() - 0.5) * 2 * R);
      const top = Math.min(CY - 2, Math.ceil(center.y + R));
      const bottom = Math.max(0, Math.floor(center.y - R));
      for (let y = top; y >= bottom; y--) {
        if (!IS_SOLID[this.world.getBlockWorld(ox, y, oz)]) continue;
        if (this.world.getBlockWorld(ox, y + 1, oz) !== Block.AIR) break;
        this.world.editBlock(ox, y + 1, oz, Block.FIRE);
        this.fires.push({
          x: ox,
          y: y + 1,
          z: oz,
          expire: this.clock + FIRE_LIFETIME_MIN + Math.random() * (FIRE_LIFETIME_MAX - FIRE_LIFETIME_MIN),
        });
        break;
      }
    }
  }
}
