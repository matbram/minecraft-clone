// Wireframe box drawn around the currently targeted block.

import * as THREE from 'three';

export class BlockOutline {
  private readonly mesh: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setTarget(cell: { x: number; y: number; z: number } | null): void {
    if (!cell) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
  }
}
