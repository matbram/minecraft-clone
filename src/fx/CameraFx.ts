// Sprint FOV nudge. Eases the camera FOV up while sprint-moving on the ground
// and back otherwise; rebuilds the projection matrix only when it changes.

import type * as THREE from 'three';
import { PlayerMode, type Player } from '../player/Player';
import type { Input } from '../player/Input';

const FOV_BASE = 70;
const FOV_SPRINT = 78;
const FOV_WATER = 66; // slightly narrower underwater — a dense-medium lens cue
const LERP = 8;
// Phase 15: explosion screen shake. Trauma (0..1) decays steadily; the applied shake is
// trauma^2 (so it ramps off smoothly), as positional jitter + a little camera roll.
const TRAUMA_DECAY = 1.5; // trauma units lost per second
const SHAKE_POS = 0.35; // max positional jitter (blocks) at full trauma
const SHAKE_ROLL = 0.06; // max roll (radians) at full trauma

export class CameraFx {
  private trauma = 0;

  constructor(private readonly input: Input) {}

  // Add screen-shake energy (e.g. from a nearby explosion). Clamped to 1.
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

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

    // Screen shake: runs after applyToCamera (and before view-bob), so jitter is an
    // additive offset on the freshly-set camera transform.
    if (this.trauma > 1e-3) {
      this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
      const s = this.trauma * this.trauma;
      camera.position.x += (Math.random() - 0.5) * SHAKE_POS * s;
      camera.position.y += (Math.random() - 0.5) * SHAKE_POS * s;
      camera.position.z += (Math.random() - 0.5) * SHAKE_POS * s;
      camera.rotation.z += (Math.random() - 0.5) * SHAKE_ROLL * s;
    }
  }
}
