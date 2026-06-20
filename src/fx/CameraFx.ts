// Sprint FOV nudge. Eases the camera FOV up while sprint-moving on the ground
// and back otherwise; rebuilds the projection matrix only when it changes.

import type * as THREE from 'three';
import { PlayerMode, type Player } from '../player/Player';
import type { Input } from '../player/Input';

const FOV_BASE = 70;
const FOV_SPRINT = 78;
const FOV_WATER = 66; // slightly narrower underwater — a dense-medium lens cue
const LERP = 8;

export class CameraFx {
  constructor(private readonly input: Input) {}

  update(camera: THREE.PerspectiveCamera, player: Player, dt: number): void {
    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    const moving = hspeed > 0.5 && player.onGround && player.mode === PlayerMode.WALK;
    const sprinting = this.input.isDown('ControlLeft');
    const target = player.inWater ? FOV_WATER : sprinting && moving ? FOV_SPRINT : FOV_BASE;

    let next = camera.fov + (target - camera.fov) * (1 - Math.exp(-LERP * dt));
    if (Math.abs(next - target) < 0.05) next = target; // settle exactly
    if (Math.abs(next - camera.fov) > 0.01) {
      camera.fov = next;
      camera.updateProjectionMatrix();
    }
  }
}
