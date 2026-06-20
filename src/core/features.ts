// Feature templates: pure block-offset lists relative to an anchor point.
//
// WorldGen emits deterministic feature *decisions* (where + which variant).
// The main thread expands a decision into absolute block writes, spilling any
// block that lands in a neighbor chunk into World.pending. Templates here have
// no notion of chunks, so they place cleanly across borders.

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

export type FeatureKind = 'tree' | 'grass';

// A feature decision: anchor in WORLD coords + which template/variant.
export interface FeatureDecision {
  wx: number;
  wy: number; // surface y (anchor sits at wy, the feature builds from wy+1 up)
  wz: number;
  kind: FeatureKind;
  variant: number;
}

// Build an oak-ish tree: a trunk of `height` logs topped by a leaf blob.
export function treeTemplate(variant: number): FeatureTemplate {
  const height = 4 + (variant % 3); // 4..6 logs
  const blocks: BlockOffset[] = [];

  // Trunk.
  for (let h = 1; h <= height; h++) {
    blocks.push({ dx: 0, dy: h, dz: 0, type: Block.LOG });
  }

  // Canopy: two wide layers + a small cap.
  const top = height;
  const addLeaf = (dx: number, dy: number, dz: number) => {
    // Don't overwrite the trunk column on canopy layers.
    if (dx === 0 && dz === 0 && dy <= top) return;
    blocks.push({ dx, dy, dz, type: Block.LEAVES });
  };
  for (let dy = top - 1; dy <= top; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        // Trim the corners of the 5x5 to round it off.
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        addLeaf(dx, dy, dz);
      }
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue; // plus-shape cap
      addLeaf(dx, top + 1, dz);
    }
  }
  // Single top leaf.
  addLeaf(0, top + 2, 0);

  return { blocks };
}

// Tall grass / shrub: a single decorative block above the surface.
// (Rendered as leaves for now; a dedicated cross/plant mesh can come later.)
export function grassTemplate(_variant: number): FeatureTemplate {
  return { blocks: [{ dx: 0, dy: 1, dz: 0, type: Block.LEAVES }] };
}

export function templateFor(d: FeatureDecision): FeatureTemplate {
  return d.kind === 'tree' ? treeTemplate(d.variant) : grassTemplate(d.variant);
}
