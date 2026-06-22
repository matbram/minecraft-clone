// Phase 15.6: first-person held-item view model. A small THREE.Group parented to the
// camera (so it inherits view-bob + sprint-FOV automatically — no per-frame camera-space
// math), showing a blocky arm holding the currently-selected item. Plain blocks render as
// a textured atlas cube (the ItemDrops UV pattern); weapons / apple / torch get simple
// procedural shapes. The torch carries the SAME additive bloom flame as the rocket/
// explosion fire (reusing FireRenderer.flameColor) at its tip, plus drifting world-space
// embers via Effects.fireEmber. Visible only in first-person.
//
// Exports TorchFlame + buildHeldItem so the third-person PlayerModel reuses them.

import * as THREE from 'three';
import { Block, IS_WEAPON, IS_EDIBLE, ATLAS_COLS, tileOf } from '../core/BlockTypes';
import { ATLAS_ROWS } from '../render/atlas';
import { flameColor } from './FireRenderer';

const TAU = Math.PI * 2;
const SKIN = 0x9c6b4a;
const STICK_LEN = 0.42; // torch stick length (held-item local units)

function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// A tiny instanced additive flame (a handful of small cubes that rise, cool + flicker on a
// looping phase) reusing the rocket flame colour ramp. Origin at the base of the flame;
// `tipLocal` is the height the flame reaches so callers can spawn embers there.
export class TorchFlame {
  readonly group = new THREE.Group();
  readonly tipLocal: number;
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly height: number;
  private readonly radius: number;
  private readonly size: number;

  constructor(scale = 1, cubes = 12) {
    this.height = 0.34 * scale;
    this.radius = 0.07 * scale;
    this.size = 0.075 * scale;
    this.tipLocal = this.height;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false, // keep > 1 colours hot into the bloom pass
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cubes);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cubes * 3), 3);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  update(time: number): void {
    const n = this.mesh.count;
    for (let k = 0; k < n; k++) {
      const ph = k * 2.39;
      const rise = (time * 1.6 + hash01(ph)) % 1; // 0 base .. 1 tip
      const env = Math.min(1, rise / 0.1) * Math.min(1, (1 - rise) / 0.35);
      const flick = 0.7 + 0.3 * Math.sin(time * 12 + ph);
      const ang = hash01(ph + 2.7) * TAU + time * 1.4;
      const rad = this.radius * (1 - 0.7 * rise) * (0.4 + 0.6 * hash01(ph + 1.3));
      this.p.set(Math.cos(ang) * rad, rise * this.height, Math.sin(ang) * rad);
      const sc = Math.max(0.001, this.size * (1 - 0.5 * rise) * flick * env);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      flameColor(this.c, rise);
      this.c.multiplyScalar((0.8 + 0.3 * flick) * env);
      this.mesh.setColorAt(k, this.c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Box geometry whose 6 faces sample a block's atlas tiles (mirrors ItemDrops.geomFor).
function texturedCubeGeom(block: Block, size: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const tile = tileOf(block, f);
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    const u0 = col / ATLAS_COLS;
    const u1 = (col + 1) / ATLAS_COLS;
    const v0 = row / ATLAS_ROWS;
    const v1 = (row + 1) / ATLAS_ROWS;
    for (let k = 0; k < 4; k++) {
      const vi = f * 4 + k;
      const ux = uv.getX(vi);
      const uy = uv.getY(vi);
      uv.setXY(vi, u0 + ux * (u1 - u0), v0 + (1 - uy) * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
  return g;
}

function box(w: number, h: number, l: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshBasicMaterial({ color }));
}

// Build the in-hand object for the selected item. The TORCH returns just the stick (its
// tip is at +Y STICK_LEN/2); callers add a TorchFlame there. Returned object is sized in
// "held-item" units (~a third of a block) and is re-parented/scaled by the caller.
export function buildHeldItem(block: Block, atlas: THREE.Texture): THREE.Object3D {
  if (block === Block.TORCH) {
    const stick = box(0.07, STICK_LEN, 0.07, 0x5a3a1c);
    stick.name = 'stick';
    return stick;
  }
  if (IS_WEAPON[block]) {
    const g = new THREE.Group();
    if (block === Block.FLAMETHROWER) {
      const body = box(0.12, 0.16, 0.4, 0x3a3a3e);
      const tank = box(0.14, 0.26, 0.14, 0xb5402a);
      tank.position.set(0, 0.02, -0.18);
      const nozzle = box(0.07, 0.07, 0.28, 0x6a6a70);
      nozzle.position.set(0, 0.02, 0.3);
      g.add(body, tank, nozzle);
    } else {
      const tube = box(0.12, 0.12, 0.62, 0x44464d); // launcher barrel
      const grip = box(0.08, 0.16, 0.1, 0x2c2c30);
      grip.position.set(0, -0.13, -0.05);
      const sight = box(0.05, 0.06, 0.05, 0x202024);
      sight.position.set(0, 0.09, 0.06);
      g.add(tube, grip, sight);
    }
    return g;
  }
  if (IS_EDIBLE[block]) {
    const g = new THREE.Group();
    g.add(box(0.22, 0.22, 0.22, 0xc8302a)); // apple body
    const stem = box(0.03, 0.07, 0.03, 0x5a3a1c);
    stem.position.set(0, 0.13, 0);
    g.add(stem);
    return g;
  }
  // default: a small textured block cube
  return new THREE.Mesh(texturedCubeGeom(block, 0.32), new THREE.MeshBasicMaterial({ map: atlas }));
}

export class ViewModel {
  private readonly group = new THREE.Group(); // parented to the camera
  private readonly hand = new THREE.Group(); // bobs/swings; holds arm + item
  private readonly arm: THREE.Mesh;
  private readonly atlas: THREE.Texture;
  private item: THREE.Object3D | null = null;
  private flame: TorchFlame | null = null;
  private current = -1; // last-built Block (-1 = none)
  private bobPhase = 0;
  private swing = 0; // 0..1 use-swing impulse, decays
  private readonly tipWorld = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, atlas: THREE.Texture) {
    this.atlas = atlas;
    this.arm = box(0.16, 0.5, 0.16, SKIN);
    this.arm.rotation.set(-0.5, 0.2, 0.1);
    this.arm.position.set(-0.05, -0.28, 0.12);
    this.hand.add(this.arm);
    this.group.add(this.hand);
    this.group.position.set(0.42, -0.4, -0.7); // lower-right, just in front of the eye
    camera.add(this.group);
  }

  private rebuild(block: Block): void {
    if (this.item) {
      this.hand.remove(this.item);
      this.item = null;
    }
    if (this.flame) {
      this.hand.remove(this.flame.group);
      this.flame = null;
    }
    this.current = block;
    const obj = buildHeldItem(block, this.atlas);
    obj.position.set(0.08, 0.06, 0.02);
    this.hand.add(obj);
    this.item = obj;
    if (block === Block.TORCH) {
      this.flame = new TorchFlame(1.1, 12);
      this.flame.group.position.set(0.08, 0.06 + STICK_LEN / 2, 0.02); // stick tip
      this.hand.add(this.flame.group);
    }
  }

  // visible: first-person only. speed: player horizontal speed (drives the walk bob).
  // emberAt: spawns a world-space ember (Effects.fireEmber) at the torch tip.
  update(
    dt: number,
    time: number,
    block: Block,
    visible: boolean,
    speed: number,
    emberAt: (x: number, y: number, z: number) => void,
  ): void {
    this.group.visible = visible;
    if (!visible) return;
    if (block !== this.current) this.rebuild(block);

    // Walk bob + idle sway, plus a decaying use-swing.
    this.bobPhase += dt * (4 + speed * 1.6);
    const amp = Math.min(0.05, 0.012 + speed * 0.012);
    this.hand.position.set(Math.cos(this.bobPhase) * amp * 0.6, Math.sin(this.bobPhase * 2) * amp, 0);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4);
    this.hand.rotation.x = -Math.sin(this.swing * Math.PI) * 0.9;

    if (this.flame) {
      this.flame.update(time);
      // Drifting embers in world space (computed from the tip's true world position).
      this.flame.group.updateWorldMatrix(true, false);
      if (Math.random() < 0.35) {
        this.flame.group.getWorldPosition(this.tipWorld);
        emberAt(this.tipWorld.x, this.tipWorld.y, this.tipWorld.z);
      }
    }
  }

  // Kick the use-swing animation (left-click / place / eat).
  triggerSwing(): void {
    this.swing = 1;
  }
}
