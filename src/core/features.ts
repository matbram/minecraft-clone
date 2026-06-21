// Feature templates: pure block-offset lists relative to an anchor point.
//
// WorldGen emits deterministic feature *decisions* (where + which tree type/variant).
// The main thread expands a decision into absolute block writes, spilling any block that
// lands in a neighbor chunk into World.pending. Templates have no notion of chunks, so
// they place cleanly across borders. (Ground plants are written inline by WorldGen — they
// are single local cells and never spill.)

import { Block } from './BlockTypes';

export interface BlockOffset {
  dx: number;
  dy: number; // relative to the anchor (the surface block the feature sits on)
  dz: number;
  type: Block;
}

export interface FeatureTemplate {
  blocks: BlockOffset[];
}

export type FeatureKind = 'tree';

export enum TreeType {
  OAK = 0,
  SPRUCE = 1,
  JUNGLE = 2,
  ACACIA = 3,
  CACTUS = 4,
}

// A feature decision: anchor in WORLD coords + which tree type/variant.
export interface FeatureDecision {
  wx: number;
  wy: number; // surface y (anchor sits at wy, the feature builds from wy+1 up)
  wz: number;
  kind: FeatureKind;
  tree: TreeType;
  variant: number;
}

// --- tree templates --------------------------------------------------------

function oak(variant: number): FeatureTemplate {
  const height = 4 + (variant % 3); // 4..6 logs
  const blocks: BlockOffset[] = [];
  for (let h = 1; h <= height; h++) blocks.push({ dx: 0, dy: h, dz: 0, type: Block.LOG });
  const top = height;
  const leaf = (dx: number, dy: number, dz: number) => {
    if (dx === 0 && dz === 0 && dy <= top) return; // keep the trunk column
    blocks.push({ dx, dy, dz, type: Block.LEAVES });
  };
  for (let dy = top - 1; dy <= top; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        leaf(dx, dy, dz);
      }
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
      leaf(dx, top + 1, dz);
    }
  leaf(0, top + 2, 0);
  return { blocks };
}

// Conical evergreen: tall trunk with leaf rings that widen toward the base + a pointed tip.
function spruce(variant: number): FeatureTemplate {
  const height = 6 + (variant % 4); // 6..9
  const blocks: BlockOffset[] = [];
  for (let h = 1; h <= height; h++) blocks.push({ dx: 0, dy: h, dz: 0, type: Block.LOG });
  for (let layer = 0; layer <= height - 2; layer++) {
    const dy = 2 + layer;
    let r = 2 - Math.floor(layer / 2); // 2 near the bottom -> 0 near the top
    if (r < 0) r = 0;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + 1) continue; // diamond rings
        if (dx === 0 && dz === 0 && dy <= height) continue;
        blocks.push({ dx, dy, dz, type: Block.LEAVES });
      }
  }
  blocks.push({ dx: 0, dy: height + 1, dz: 0, type: Block.LEAVES }); // tip
  return { blocks };
}

// Tall tropical tree: long trunk, compact canopy at the very top.
function jungle(variant: number): FeatureTemplate {
  const height = 9 + (variant % 5); // 9..13
  const blocks: BlockOffset[] = [];
  for (let h = 1; h <= height; h++) blocks.push({ dx: 0, dy: h, dz: 0, type: Block.LOG });
  const top = height;
  const leaf = (dx: number, dy: number, dz: number) => {
    if (dx === 0 && dz === 0 && dy <= top) return;
    blocks.push({ dx, dy, dz, type: Block.LEAVES });
  };
  for (let dy = top - 1; dy <= top; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        leaf(dx, dy, dz);
      }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) leaf(dx, top + 1, dz);
  return { blocks };
}

// Savanna acacia: short trunk topped by a flat, wide leaf disc.
function acacia(variant: number): FeatureTemplate {
  const height = 4 + (variant % 3); // 4..6
  const blocks: BlockOffset[] = [];
  for (let h = 1; h <= height; h++) blocks.push({ dx: 0, dy: h, dz: 0, type: Block.LOG });
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= 9) blocks.push({ dx, dy: height + 1, dz, type: Block.LEAVES });
      if (d2 <= 4) blocks.push({ dx, dy: height, dz, type: Block.LEAVES }); // thin under-layer
    }
  return { blocks };
}

// Cactus: a short column of cactus blocks, no leaves.
function cactus(variant: number): FeatureTemplate {
  const height = 1 + (variant % 3); // 1..3
  const blocks: BlockOffset[] = [];
  for (let h = 1; h <= height; h++) blocks.push({ dx: 0, dy: h, dz: 0, type: Block.CACTUS });
  return { blocks };
}

export function templateFor(d: FeatureDecision): FeatureTemplate {
  switch (d.tree) {
    case TreeType.SPRUCE:
      return spruce(d.variant);
    case TreeType.JUNGLE:
      return jungle(d.variant);
    case TreeType.ACACIA:
      return acacia(d.variant);
    case TreeType.CACTUS:
      return cactus(d.variant);
    default:
      return oak(d.variant);
  }
}
