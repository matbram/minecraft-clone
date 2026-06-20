// Shared message types between the main thread and the generation worker.
// TYPE-ONLY module (no runtime code) so importing it never drags code into the
// worker bundle. Both sides import these with `import type { ... }`.

import type { FeatureDecision } from '../core/features';

export interface GenRequest {
  id: number;
  cx: number;
  cz: number;
  seed: number;
}

export interface GenResponse {
  id: number;
  cx: number;
  cz: number;
  data: ArrayBuffer; // transferred Uint8Array(BLOCKS).buffer
  heightMap: ArrayBuffer; // transferred Uint8Array(COLS).buffer
  maxY: number;
  features: FeatureDecision[]; // small plain objects -> structured clone
}
