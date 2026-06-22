// Phase 15.6: third-person player body. A blocky Minecraft-style figure (head, torso, two
// arms, two legs) shown only in third-person (F5). Built from the same merged vertex-coloured
// box pattern as the fauna (reusing Fauna.addBox for per-face shading), but split into
// animated parts (head pitches, legs + free arm swing while walking). The right arm holds the
// currently-selected item (reusing buildHeldItem); a held torch carries the rocket-style
// additive flame (TorchFlame) at the hand, with drifting world-space embers. Tinted by the
// baked world light so it darkens in caves / at night, like the fauna and dropped items.

import * as THREE from 'three';
import { Block } from '../core/BlockTypes';
import { addBox } from '../world/Fauna';
import { buildHeldItem, TorchFlame } from '../fx/ViewModel';
import type { World } from '../world/World';

type RGB = [number, number, number];

const SKIN: RGB = [0.78, 0.56, 0.43];
const SHIRT: RGB = [0.2, 0.55, 0.72];
const PANTS: RGB = [0.27, 0.29, 0.46];
const HAIR: RGB = [0.3, 0.2, 0.12];
const EYE: RGB = [0.08, 0.08, 0.1];

// Body proportions (blocks; feet at y=0, ~1.85 tall so the eye line ≈ EYE_HEIGHT 1.62).
const LEG_H = 0.72;
const HIP_Y = LEG_H;
const TORSO_W = 0.5;
const TORSO_D = 0.26;
const TORSO_H = 0.68;
const SHOULDER_Y = HIP_Y + TORSO_H; // 1.4
const HEAD = 0.46;
const ARM_H = 0.68;
const ARM_W = 0.16;
const ARM_X = TORSO_W / 2 + ARM_W / 2; // 0.33
const LEG_W = 0.18;
const LEG_X = 0.11;
const STICK_TIP = 0.21; // torch stick half-length (matches ViewModel STICK_LEN/2)

interface BoxSpec {
  cx: number; cy: number; cz: number; w: number; h: number; l: number; col: RGB;
}

function partGeom(boxes: BoxSpec[]): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  for (const b of boxes) addBox(P, N, C, I, b.cx, b.cy, b.cz, b.w, b.h, b.l, b.col);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

export class PlayerModel {
  private readonly root = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group(); // holds the item
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial; // shared across parts -> one light tint
  private readonly atlas: THREE.Texture;
  private readonly world: World;
  private item: THREE.Object3D | null = null;
  private flame: TorchFlame | null = null;
  private current = -1;
  private walkPhase = 0;
  private readonly handWorld = new THREE.Vector3();

  constructor(scene: THREE.Scene, world: World, atlas: THREE.Texture) {
    this.world = world;
    this.atlas = atlas;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true });

    // Torso (static).
    this.root.add(new THREE.Mesh(partGeom([
      { cx: 0, cy: HIP_Y + TORSO_H / 2, cz: 0, w: TORSO_W, h: TORSO_H, l: TORSO_D, col: SHIRT },
    ]), this.mat));

    // Head (+ hair cap + eyes), pivot at the neck so it can pitch.
    const headMesh = new THREE.Mesh(partGeom([
      { cx: 0, cy: HEAD / 2, cz: 0, w: HEAD, h: HEAD, l: HEAD, col: SKIN },
      { cx: 0, cy: HEAD * 0.82, cz: -0.02, w: HEAD * 1.02, h: HEAD * 0.4, l: HEAD * 1.02, col: HAIR },
      { cx: HEAD * 0.22, cy: HEAD * 0.5, cz: HEAD / 2, w: 0.08, h: 0.08, l: 0.04, col: EYE },
      { cx: -HEAD * 0.22, cy: HEAD * 0.5, cz: HEAD / 2, w: 0.08, h: 0.08, l: 0.04, col: EYE },
    ]), this.mat);
    this.head.add(headMesh);
    this.head.position.set(0, SHOULDER_Y, 0);
    this.root.add(this.head);

    // Arms — sleeve (shirt) upper half + skin lower half. Pivot at the shoulder (top).
    const armGeom = partGeom([
      { cx: 0, cy: -ARM_H / 4, cz: 0, w: ARM_W, h: ARM_H / 2, l: ARM_W, col: SHIRT },
      { cx: 0, cy: (-ARM_H * 3) / 4, cz: 0, w: ARM_W, h: ARM_H / 2, l: ARM_W, col: SKIN },
    ]);
    this.armL.add(new THREE.Mesh(armGeom, this.mat));
    this.armR.add(new THREE.Mesh(armGeom, this.mat));
    this.armL.position.set(-ARM_X, SHOULDER_Y, 0);
    this.armR.position.set(ARM_X, SHOULDER_Y, 0);
    this.root.add(this.armL, this.armR);

    // Legs — pivot at the hip (top).
    const legGeom = partGeom([{ cx: 0, cy: -LEG_H / 2, cz: 0, w: LEG_W, h: LEG_H, l: LEG_W, col: PANTS }]);
    this.legL.add(new THREE.Mesh(legGeom, this.mat));
    this.legR.add(new THREE.Mesh(legGeom, this.mat));
    this.legL.position.set(-LEG_X, HIP_Y, 0);
    this.legR.position.set(LEG_X, HIP_Y, 0);
    this.root.add(this.legL, this.legR);

    this.root.visible = false;
    scene.add(this.root);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  private rebuildItem(block: Block): void {
    if (this.item) {
      this.armR.remove(this.item);
      this.item = null;
    }
    if (this.flame) {
      this.armR.remove(this.flame.group);
      this.flame = null;
    }
    this.current = block;
    const obj = buildHeldItem(block, this.atlas);
    obj.position.set(0, -ARM_H + 0.04, 0.06); // in the hand
    this.armR.add(obj);
    this.item = obj;
    if (block === Block.TORCH) {
      this.flame = new TorchFlame(1.0, 12);
      this.flame.group.position.set(0, -ARM_H + 0.04 + STICK_TIP, 0.06); // stick tip
      this.armR.add(this.flame.group);
    }
  }

  // Called each frame. ex/ey/ez = interpolated feet; speed = horizontal speed (walk anim).
  update(
    dt: number,
    time: number,
    ex: number,
    ey: number,
    ez: number,
    yaw: number,
    pitch: number,
    speed: number,
    block: Block,
    fxSkyMul: number,
    emberAt: (x: number, y: number, z: number) => void,
  ): void {
    if (!this.root.visible) return;
    if (block !== this.current) this.rebuildItem(block);

    this.root.position.set(ex, ey, ez);
    this.root.rotation.y = yaw + Math.PI; // model faces +Z -> face the look direction
    this.head.rotation.x = THREE.MathUtils.clamp(-pitch * 0.7, -1.1, 1.1);

    // Walk cycle: legs + free (left) arm swing; the right arm stays posed forward holding
    // the item. Phase only advances while moving, so it settles to a neutral stand when idle.
    const moveAmt = Math.min(1, speed / 2.2);
    this.walkPhase += dt * 9 * moveAmt;
    const swing = Math.sin(this.walkPhase) * 0.6 * moveAmt;
    this.legR.rotation.x = swing;
    this.legL.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = -1.0 + swing * 0.15; // forward to present the held item

    // Tint by the baked light at the torso (clamped under the bloom threshold like fauna).
    const b = Math.max(0.2, Math.min(0.85, this.world.brightnessAt(Math.floor(ex), Math.floor(ey + 1), Math.floor(ez), fxSkyMul)));
    this.mat.color.setScalar(b);

    if (this.flame) {
      this.flame.update(time);
      this.flame.group.updateWorldMatrix(true, false);
      if (Math.random() < 0.4) {
        this.flame.group.getWorldPosition(this.handWorld);
        emberAt(this.handWorld.x, this.handWorld.y, this.handWorld.z);
      }
    }
  }
}
