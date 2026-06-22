// Owns the THREE.Mesh objects in the scene, one opaque + one transparent per
// chunk. Builds BufferGeometry from the mesher's typed arrays and DISPOSES
// geometry on unload (critical to avoid GPU memory leaks / GC stalls).

import * as THREE from 'three';
import { CX, CZ, LAYER_TRANSPARENT, LAYER_SHADOW_CASTER } from '../core/constants';
import { chunkKey } from '../world/chunkKey';
import type { Materials } from './materials';
import type { BuiltChunk, MeshArrays } from './ChunkMesh';
import type { WaterMeshArrays } from './water/WaterSurfaceMesh';

interface ChunkMeshes {
  opaque?: THREE.Mesh;
  transparent?: THREE.Mesh;
  water?: THREE.Mesh; // Phase 17: continuous water surface (own material/geometry)
}

export class ChunkRenderer {
  private readonly scene: THREE.Scene;
  private readonly mats: Materials;
  private readonly waterMat: THREE.Material;
  private readonly meshes = new Map<string, ChunkMeshes>();
  private waterVisible = true; // Phase 17: gated on QualitySettings.waterSurface

  constructor(scene: THREE.Scene, mats: Materials, waterMat: THREE.Material) {
    this.scene = scene;
    this.mats = mats;
    this.waterMat = waterMat;
  }

  private buildGeometry(a: MeshArrays): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uvs, 2));
    g.setAttribute('light', new THREE.BufferAttribute(a.light, 3));
    g.setAttribute('wave', new THREE.BufferAttribute(a.wave, 1));
    g.setAttribute('refl', new THREE.BufferAttribute(a.refl, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(a.tint, 3));
    g.setIndex(new THREE.BufferAttribute(a.indices, 1)); // Uint32 (chunks exceed 65k verts)
    g.computeBoundingSphere();
    return g;
  }

  setChunk(cx: number, cz: number, built: BuiltChunk, water: WaterMeshArrays | null): void {
    const key = chunkKey(cx, cz);
    let entry = this.meshes.get(key);
    if (!entry) {
      entry = {};
      this.meshes.set(key, entry);
    }

    this.applyPass(entry, 'opaque', cx, cz, built.opaque, this.mats.opaque);
    this.applyPass(entry, 'transparent', cx, cz, built.transparent, this.mats.transparent);
    this.applyWater(entry, cx, cz, water);
  }

  // Phase 17: rebuild ONLY the water surface for a chunk (the fast real-time-fill path,
  // independent of the heavier block remesh). Creates a water-only entry if needed.
  setWater(cx: number, cz: number, water: WaterMeshArrays | null): void {
    const key = chunkKey(cx, cz);
    let entry = this.meshes.get(key);
    if (!entry) {
      entry = {};
      this.meshes.set(key, entry);
    }
    this.applyWater(entry, cx, cz, water);
  }

  // Phase 17: gate the water surface visibility on the quality preset (waterSurface).
  setWaterEnabled(on: boolean): void {
    if (on === this.waterVisible) return;
    this.waterVisible = on;
    for (const entry of this.meshes.values()) {
      if (entry.water) entry.water.visible = on;
    }
  }

  private buildWaterGeometry(a: WaterMeshArrays): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
    g.setAttribute('flow', new THREE.BufferAttribute(a.flow, 2));
    g.setAttribute('light', new THREE.BufferAttribute(a.light, 2));
    g.setAttribute('edge', new THREE.BufferAttribute(a.edge, 1));
    g.setAttribute('depth', new THREE.BufferAttribute(a.depth, 1));
    g.setIndex(new THREE.BufferAttribute(a.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  private applyWater(entry: ChunkMeshes, cx: number, cz: number, arrays: WaterMeshArrays | null): void {
    const old = entry.water;
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      entry.water = undefined;
    }
    if (!arrays) return;
    const mesh = new THREE.Mesh(this.buildWaterGeometry(arrays), this.waterMat);
    mesh.position.set(cx * CX, 0, cz * CZ);
    mesh.frustumCulled = true;
    mesh.renderOrder = 1; // opaque(0) -> water(1) -> glass/leaves; depthWrite off
    // Live ONLY on the transparent layer so the planar-reflection camera (default
    // mask) never sees/reflects the water surface itself (no feedback).
    mesh.layers.set(LAYER_TRANSPARENT);
    mesh.visible = this.waterVisible;
    this.scene.add(mesh);
    entry.water = mesh;
  }

  private applyPass(
    entry: ChunkMeshes,
    pass: 'opaque' | 'transparent',
    cx: number,
    cz: number,
    arrays: MeshArrays | null,
    material: THREE.Material,
  ): void {
    // Remove the old mesh for this pass (geometry rebuilt fully each time).
    const old = entry[pass];
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      entry[pass] = undefined;
    }
    if (!arrays) return;

    const geom = this.buildGeometry(arrays);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(cx * CX, 0, cz * CZ); // local geometry coords + chunk offset
    mesh.frustumCulled = true;
    if (pass === 'transparent') {
      // Phase 17 triplet: opaque(0) -> water(1) -> glass/leaves(2), so the water sheet
      // draws after the opaque bottom but before glass. depthWrite off (material).
      mesh.renderOrder = 2;
      // Transparent (glass) lives ONLY on the transparent layer so the planar-reflection
      // camera (default mask) never reflects it / the water. The main camera enables this
      // layer (see main.ts) to keep seeing it.
      mesh.layers.set(LAYER_TRANSPARENT);
    } else {
      // Opaque chunks also cast sun shadows -> add the shadow-caster layer.
      mesh.layers.enable(LAYER_SHADOW_CASTER);
    }
    this.scene.add(mesh);
    entry[pass] = mesh;
  }

  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const m of [entry.opaque, entry.transparent, entry.water]) {
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    this.meshes.delete(key);
  }

  has(cx: number, cz: number): boolean {
    return this.meshes.has(chunkKey(cx, cz));
  }
}
