// Sun + moon sprites that orbit on the day/night cycle. The sun has a bright
// additive glow (which blooms and feeds god rays). Reports the sun's screen
// position for the god-rays pass.

import * as THREE from 'three';
import type { DayNight } from './DayNight';

const DIST = 480; // inside the sky dome radius (600)

function discTexture(stops: Array<[number, string]>, size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class SunMoon {
  private readonly sun: THREE.Sprite;
  private readonly glow: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly worldPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly toSun = new THREE.Vector3();
  private enabled = true;

  constructor(scene: THREE.Scene) {
    const sunTex = discTexture([
      [0, 'rgba(255,250,235,1)'],
      [0.5, 'rgba(255,240,200,1)'],
      [1, 'rgba(255,230,170,0)'],
    ]);
    const glowTex = discTexture([
      [0, 'rgba(255,235,190,0.9)'],
      [0.3, 'rgba(255,210,150,0.35)'],
      [1, 'rgba(255,200,140,0)'],
    ]);
    const moonTex = discTexture([
      [0, 'rgba(245,248,255,1)'],
      [0.6, 'rgba(210,220,240,1)'],
      [1, 'rgba(200,210,235,0)'],
    ]);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }),
    );
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }),
    );
    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.glow.scale.setScalar(160);
    this.sun.scale.setScalar(50);
    this.moon.scale.setScalar(40);
    for (const s of [this.glow, this.sun, this.moon]) {
      s.renderOrder = -1; // behind world geometry, in front of sky dome
      scene.add(s);
    }
  }

  update(camPos: THREE.Vector3, day: DayNight): void {
    this.sun.position.copy(camPos).addScaledVector(day.sunDir, DIST);
    this.glow.position.copy(this.sun.position);
    this.moon.position.copy(camPos).addScaledVector(day.moonDir, DIST);

    const sunUp = THREE.MathUtils.clamp(day.sunDir.y * 3 + 0.3, 0, 1);
    const moonUp = THREE.MathUtils.clamp(day.moonDir.y * 3 + 0.3, 0, 1);
    this.sun.material.opacity = sunUp;
    this.glow.material.opacity = sunUp;
    this.moon.material.opacity = moonUp * 0.9;
    this.sun.visible = this.enabled && sunUp > 0.01;
    this.glow.visible = this.enabled && sunUp > 0.01;
    this.moon.visible = this.enabled && moonUp > 0.01;
  }

  // Project the sun to screen UV (0..1). Returns false if behind the camera.
  // Ensures camera matrices are current (this runs before the composer render).
  sunScreenPos(camera: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.getWorldDirection(this.fwd);
    this.toSun.copy(this.sun.position).sub(camera.position);
    if (this.toSun.dot(this.fwd) <= 0) return false; // behind camera
    this.worldPos.copy(this.sun.position).project(camera); // -> NDC
    out.set((this.worldPos.x + 1) / 2, (this.worldPos.y + 1) / 2, 0);
    return true;
  }

  setVisible(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.sun.visible = false;
      this.glow.visible = false;
      this.moon.visible = false;
    }
  }
}
