// Phase 15.1: rocket warhead types. `mul` scales every blast quantity (crater radius,
// damage, knockback, fireball, fire count, FX). Cycle with R; the Tuning panel
// "Explosion power" knob multiplies on top. Crater radius is still clamped to
// EXPLOSION_CRATER_MAX so even a Nuke × a cranked slider can't freeze the page.

export interface Ammo {
  name: string;
  mul: number;
}

export const AMMO: readonly Ammo[] = [
  { name: 'Standard', mul: 1 },
  { name: 'Heavy', mul: 2 },
  { name: 'MOAB', mul: 4 },
  { name: 'Nuke', mul: 8 },
];
