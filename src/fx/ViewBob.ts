// Gentle walking view-bob. Applied to the camera AFTER aim raycasting so the
// crosshair stays steady. Reads only player state; mutates only camera.position.

import * as THREE from 'three';
import { PlayerMode, type Player } from '../player/Player';

const AMP_MAX = 0.045;
const AMP_K = 0.012;
const FREQ_BASE = 6;
const FREQ_K = 1.4;
const LATERAL = 0.6;

export class ViewBob {
  private phase = 0;
  private ampSmooth = 0;
  private readonly right = new THREE.Vector3();

  apply(camera: THREE.PerspectiveCamera, player: Player, dt: number): void {
    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    const active = player.onGround && player.mode === PlayerMode.WALK && hspeed > 0.5;
    const targetAmp = active ? Math.min(AMP_MAX, hspeed * AMP_K) : 0;
    this.ampSmooth += (targetAmp - this.ampSmooth) * (1 - Math.exp(-10 * dt));
    if (active) this.phase += dt * (FREQ_BASE + hspeed * FREQ_K);
    if (this.ampSmooth < 1e-4) return;

    const dy = Math.sin(this.phase * 2) * this.ampSmooth;
    const dx = Math.sin(this.phase) * this.ampSmooth * LATERAL;
    // camera.quaternion is kept in sync when camera.rotation is set, so this is
    // the up-to-date world-space right vector without forcing a matrix update.
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(this.right, dx);
    camera.position.y += dy;
  }
}
