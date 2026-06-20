// Physics player. Position is the FEET origin (centered in X/Z, bottom in Y).
// tick() runs ONE fixed step (20 TPS): jump -> horizontal accel/drag -> gravity
// -> move-and-collide axis by axis. onGround is decided fresh each tick during
// collision (the Phase-0-spec fix: never reset it from stale state).

import * as THREE from 'three';
import {
  PLAYER_HALF_WIDTH as HALF,
  PLAYER_HEIGHT as HEIGHT,
  EYE_HEIGHT,
  PLAYER_EPS as EPS,
  GRAVITY,
  TERMINAL_VY,
  JUMP_VELOCITY,
  WALK_SPEED,
  SPRINT_MULT,
  SNEAK_MULT,
  GROUND_ACCEL,
  AIR_ACCEL,
  GROUND_DRAG,
  AIR_DRAG,
  FLY_SPEED,
  FLY_SPRINT_MULT,
} from '../core/constants';
import { IS_SOLID } from '../core/BlockTypes';
import type { World } from '../world/World';
import type { Input } from './Input';

export enum PlayerMode {
  WALK,
  FLY,
}

interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  onGround = false;
  mode = PlayerMode.WALK;

  private readonly world: World;
  private readonly input: Input;

  constructor(world: World, input: Input, spawn: THREE.Vector3) {
    this.world = world;
    this.input = input;
    this.pos.copy(spawn);
    this.prevPos.copy(spawn);
  }

  toggleMode(): void {
    this.mode = this.mode === PlayerMode.WALK ? PlayerMode.FLY : PlayerMode.WALK;
    this.vel.set(0, 0, 0);
  }

  // Horizontal forward/right basis from yaw (ignores pitch -> intuitive).
  private basis(): { fx: number; fz: number; rx: number; rz: number } {
    const y = this.input.yaw;
    const s = Math.sin(y);
    const c = Math.cos(y);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  private wishDir(): { x: number; z: number } {
    const { fx, fz, rx, rz } = this.basis();
    let x = 0;
    let z = 0;
    if (this.input.isDown('KeyW')) {
      x += fx;
      z += fz;
    }
    if (this.input.isDown('KeyS')) {
      x -= fx;
      z -= fz;
    }
    if (this.input.isDown('KeyD')) {
      x += rx;
      z += rz;
    }
    if (this.input.isDown('KeyA')) {
      x -= rx;
      z -= rz;
    }
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  tick(dt: number): void {
    if (!this.input.locked) return; // no input while unlocked / inventory open

    if (this.mode === PlayerMode.FLY) {
      this.tickFly(dt);
      return;
    }

    const grounded = this.onGround; // from the previous tick
    const sprint = this.input.isDown('ControlLeft');
    const sneak = this.input.isDown('ShiftLeft');
    const wish = this.wishDir();

    // Jump (uses last tick's grounded state).
    if (this.input.isDown('Space') && grounded) {
      this.vel.y = JUMP_VELOCITY;
    }

    // Horizontal acceleration toward the wish direction, capped to target speed.
    let speed = WALK_SPEED;
    if (sprint) speed *= SPRINT_MULT;
    if (sneak) speed *= SNEAK_MULT;
    const accel = grounded ? GROUND_ACCEL : AIR_ACCEL;
    if (wish.x !== 0 || wish.z !== 0) {
      this.vel.x += wish.x * accel * dt;
      this.vel.z += wish.z * accel * dt;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > speed) {
        this.vel.x = (this.vel.x / hs) * speed;
        this.vel.z = (this.vel.z / hs) * speed;
      }
    } else {
      const drag = grounded ? GROUND_DRAG : AIR_DRAG;
      this.vel.x *= drag;
      this.vel.z *= drag;
    }

    // Gravity.
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -TERMINAL_VY) this.vel.y = -TERMINAL_VY;

    // Move + collide; recompute onGround.
    this.onGround = false;
    this.moveY(this.vel.y * dt);
    this.moveX(this.vel.x * dt);
    this.moveZ(this.vel.z * dt);
  }

  private tickFly(dt: number): void {
    this.onGround = false;
    this.vel.set(0, 0, 0);
    const sprint = this.input.isDown('ControlLeft');
    const speed = FLY_SPEED * (sprint ? FLY_SPRINT_MULT : 1) * dt;
    const wish = this.wishDir();
    this.pos.x += wish.x * speed;
    this.pos.z += wish.z * speed;
    if (this.input.isDown('Space')) this.pos.y += speed;
    if (this.input.isDown('ShiftLeft')) this.pos.y -= speed;
  }

  private aabb(): AABB {
    return {
      minX: this.pos.x - HALF,
      maxX: this.pos.x + HALF,
      minY: this.pos.y,
      maxY: this.pos.y + HEIGHT,
      minZ: this.pos.z - HALF,
      maxZ: this.pos.z + HALF,
    };
  }

  private hitsSolid(b: AABB): boolean {
    for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX); x++)
      for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY); y++)
        for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ); z++)
          if (IS_SOLID[this.world.getBlockWorld(x, y, z)]) return true;
    return false;
  }

  // Substep count so a single move never exceeds ~0.9 blocks (no tunneling).
  private substeps(delta: number): number {
    return Math.max(1, Math.ceil(Math.abs(delta) / 0.9));
  }

  private moveY(dy: number): void {
    const n = this.substeps(dy);
    const d = dy / n;
    for (let i = 0; i < n; i++) {
      this.pos.y += d;
      const b = this.aabb();
      if (this.hitsSolid(b)) {
        if (d < 0) {
          this.pos.y = Math.floor(b.minY) + 1 + EPS; // landed on top of block
          this.onGround = true;
        } else {
          this.pos.y = Math.floor(b.maxY) - HEIGHT - EPS; // bonked head
        }
        this.vel.y = 0;
        return;
      }
    }
  }

  private moveX(dx: number): void {
    const n = this.substeps(dx);
    const d = dx / n;
    for (let i = 0; i < n; i++) {
      this.pos.x += d;
      const b = this.aabb();
      if (this.hitsSolid(b)) {
        this.pos.x = d > 0 ? Math.floor(b.maxX) - HALF - EPS : Math.floor(b.minX) + 1 + HALF + EPS;
        this.vel.x = 0;
        return;
      }
    }
  }

  private moveZ(dz: number): void {
    const n = this.substeps(dz);
    const d = dz / n;
    for (let i = 0; i < n; i++) {
      this.pos.z += d;
      const b = this.aabb();
      if (this.hitsSolid(b)) {
        this.pos.z = d > 0 ? Math.floor(b.maxZ) - HALF - EPS : Math.floor(b.minZ) + 1 + HALF + EPS;
        this.vel.z = 0;
        return;
      }
    }
  }

  applyToCamera(camera: THREE.PerspectiveCamera, alpha: number): void {
    const ex = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const ey = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const ez = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
    camera.position.set(ex, ey + EYE_HEIGHT, ez);
    camera.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
  }

  // Player AABB at the current (non-interpolated) position — for "place inside self".
  currentAabb(): AABB {
    return this.aabb();
  }
}
