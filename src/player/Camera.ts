// Free-fly camera for Phase 0. Raw Pointer Lock API for locking only; yaw/pitch
// tracked manually and written to camera.rotation each frame (no controls helper
// fighting us). Phase 1 replaces free-fly with physics + collision.

import * as THREE from 'three';

export class FlyCamera {
  yaw = 0;
  pitch = 0;
  speed = 18; // blocks/sec
  sprintMultiplier = 3;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly keys = new Set<string>();
  locked = false;

  onLockChange: (locked: boolean) => void = () => {};

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;

    dom.addEventListener('click', () => {
      if (!this.locked) dom.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0025;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });

    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  setPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
  }

  update(dt: number): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.locked) {
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      // Use Shift for sprint only when also moving; Shift alone descends.
      const moving =
        this.keys.has('KeyW') ||
        this.keys.has('KeyS') ||
        this.keys.has('KeyA') ||
        this.keys.has('KeyD');
      const speed = this.speed * (sprint && moving ? this.sprintMultiplier : 1) * dt;

      // Horizontal forward/right derived from yaw (ignore pitch so flying is intuitive).
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      const forward = new THREE.Vector3(-sinY, 0, -cosY);
      const right = new THREE.Vector3(cosY, 0, -sinY);

      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(forward);
      if (this.keys.has('KeyS')) move.sub(forward);
      if (this.keys.has('KeyD')) move.add(right);
      if (this.keys.has('KeyA')) move.sub(right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

      // Vertical fly.
      if (this.keys.has('Space')) move.y += speed;
      if (!moving && sprint) move.y -= speed; // Shift descends when not moving
      this.camera.position.add(move);
    }
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }
}
