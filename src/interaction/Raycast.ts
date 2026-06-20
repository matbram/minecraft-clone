// Amanatides–Woo voxel DDA. Marches integer cells from the eye along the look
// direction and returns the first selectable block within maxDist, with the
// exact entry face normal and the adjacent empty cell for placement.

import type * as THREE from 'three';
import { Block, isSelectable } from '../core/BlockTypes';
import type { World } from '../world/World';

export interface RayHit {
  block: Block;
  cell: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  place: { x: number; y: number; z: number };
}

export function raycastVoxel(
  world: World,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
): RayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const nx = dir.x / len;
  const ny = dir.y / len;
  const nz = dir.z / len;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(nx);
  const stepY = Math.sign(ny);
  const stepZ = Math.sign(nz);

  const tDeltaX = nx !== 0 ? Math.abs(1 / nx) : Infinity;
  const tDeltaY = ny !== 0 ? Math.abs(1 / ny) : Infinity;
  const tDeltaZ = nz !== 0 ? Math.abs(1 / nz) : Infinity;

  let tMaxX = nx !== 0 ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) / Math.abs(nx) : Infinity;
  let tMaxY = ny !== 0 ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) / Math.abs(ny) : Infinity;
  let tMaxZ = nz !== 0 ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) / Math.abs(nz) : Infinity;

  const normal = { x: 0, y: 0, z: 0 };
  let t = 0;

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal.x = -stepX;
      normal.y = 0;
      normal.z = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal.x = 0;
      normal.y = -stepY;
      normal.z = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal.x = 0;
      normal.y = 0;
      normal.z = -stepZ;
    }
    if (t > maxDist) break;

    const b = world.getBlockWorld(x, y, z);
    if (isSelectable(b)) {
      return {
        block: b,
        cell: { x, y, z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        place: { x: x + normal.x, y: y + normal.y, z: z + normal.z },
      };
    }
  }
  return null;
}
