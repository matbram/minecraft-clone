// Phase 11b: survival state + mechanics (health / hunger / air). THREE-free and
// self-contained: tick() mutates only its own numbers from the player's per-tick
// state. The caller gates ticking on (survival enabled && pointer locked) and
// handles respawn when `dead` flips true. Creative mode simply never ticks this.

import {
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_AIR,
  GRAVITY,
  SAFE_FALL_BLOCKS,
  AIR_SECONDS,
  DROWN_DPS,
  AIR_REFILL_DPS,
  HUNGER_DRAIN_BASE,
  HUNGER_DRAIN_MOVE,
  REGEN_HUNGER,
  REGEN_DPS,
  REGEN_HUNGER_COST,
  STARVE_DPS,
  STARVE_FLOOR,
  WALK_SPEED,
} from '../core/constants';
import { IS_EDIBLE, FOOD_RESTORE, type Block } from '../core/BlockTypes';
import type { Player } from './Player';

export class Survival {
  health = MAX_HEALTH;
  hunger = MAX_HUNGER;
  air = MAX_AIR;
  dead = false;

  reset(): void {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = MAX_AIR;
    this.dead = false;
  }

  tick(dt: number, player: Player, headUnderwater: boolean): void {
    if (this.dead) return;

    // Fall damage: convert impact speed to fall height (h = v^2 / 2g) and hurt for
    // every block fallen beyond the safe threshold. Water landings never set
    // landingImpact, so dives are safe.
    if (player.landingImpact > 0) {
      const h = (player.landingImpact * player.landingImpact) / (2 * GRAVITY);
      if (h > SAFE_FALL_BLOCKS) this.health -= h - SAFE_FALL_BLOCKS;
    }

    // Air / drowning: drain while the head is submerged, then health once out of
    // air; refill quickly above water.
    if (headUnderwater) {
      this.air -= (MAX_AIR / AIR_SECONDS) * dt;
      if (this.air <= 0) {
        this.air = 0;
        this.health -= DROWN_DPS * dt;
      }
    } else if (this.air < MAX_AIR) {
      this.air = Math.min(MAX_AIR, this.air + AIR_REFILL_DPS * dt);
    }

    // Hunger drains faster while moving (sprint => horiz speed > WALK_SPEED).
    const horiz = Math.hypot(player.vel.x, player.vel.z);
    const moveFrac = Math.min(1.5, horiz / WALK_SPEED);
    this.hunger -= (HUNGER_DRAIN_BASE + HUNGER_DRAIN_MOVE * moveFrac) * dt;

    // Well-fed => slow regen (costs hunger); empty => starve to a non-lethal floor.
    if (this.hunger >= REGEN_HUNGER && this.health < MAX_HEALTH) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_DPS * dt);
      this.hunger -= REGEN_HUNGER_COST * dt;
    } else if (this.hunger <= 0) {
      this.hunger = 0;
      if (this.health > STARVE_FLOOR) {
        this.health = Math.max(STARVE_FLOOR, this.health - STARVE_DPS * dt);
      }
    }
    if (this.hunger < 0) this.hunger = 0;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  // Right-click on a held edible. Returns true if it was consumed (so the caller
  // can play a cue). No-op when full / dead / not actually food.
  eat(food: Block): boolean {
    if (this.dead || !IS_EDIBLE[food] || this.hunger >= MAX_HUNGER) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + FOOD_RESTORE[food]);
    return true;
  }
}
