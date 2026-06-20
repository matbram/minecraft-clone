// Sun + moon sprites that orbit on the day/night cycle. The sun has a bright
// additive glow (which blooms and feeds god rays). Reports the sun's screen
// position for the god-rays pass.

import * as THREE from 'three';
import type { DayNight } from './DayNight';

const DIST = 480; // inside the sky dome radius (600)
const SUN_WHITE = new THREE.Color(1, 1, 1);
const SUN_LOW = new THREE.Color(1.0, 0.42, 0.2); // deep orange-red at the horizon

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
  private readonly moonGlow: THREE.Sprite;
  private readonly worldPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly toSun = new THREE.Vector3();
  private readonly tmpCol = new THREE.Color();
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
    const moonGlowTex = discTexture([
      [0, 'rgba(190,210,255,0.5)'],
      [0.35, 'rgba(150,180,245,0.18)'],
      [1, 'rgba(120,160,235,0)'],
    ]);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }),
    );
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }),
    );
    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthTest: true, depthWrite: false }),
    );
    this.moonGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }),
    );
    this.glow.scale.setScalar(160);
    this.sun.scale.setScalar(50);
    this.moon.scale.setScalar(40);
    this.moonGlow.scale.setScalar(95);
    for (const s of [this.glow, this.sun, this.moonGlow, this.moon]) {
      // depthTest occludes them behind terrain; the sky dome doesn't write depth,
      // so they still show against the sky. renderOrder keeps them before water.
      s.renderOrder = -1;
      scene.add(s);
    }
  }

  update(camPos: THREE.Vector3, day: DayNight): void {
    this.sun.position.copy(camPos).addScaledVector(day.sunDir, DIST);
    this.glow.position.copy(this.sun.position);
    this.moon.position.copy(camPos).addScaledVector(day.moonDir, DIST);
    this.moonGlow.position.copy(this.moon.position);

    // Fade out right at the horizon so a sub-horizon sun/moon doesn't linger.
    const sunUp = THREE.MathUtils.clamp(day.sunDir.y * 6 + 0.1, 0, 1);
    const moonUp = THREE.MathUtils.clamp(day.moonDir.y * 6 + 0.1, 0, 1);
    this.sun.material.opacity = sunUp;
    this.glow.material.opacity = sunUp;
    this.moon.material.opacity = moonUp * 0.9;
    this.moonGlow.material.opacity = moonUp * 0.5;

    // Dramatic low sun: redden + enlarge the disc/glow as it nears the horizon.
    const lowSun = THREE.MathUtils.clamp(1 - day.sunDir.y / 0.25, 0, 1);
    this.tmpCol.copy(SUN_WHITE).lerp(SUN_LOW, lowSun);
    this.sun.material.color.copy(this.tmpCol);
    this.glow.material.color.copy(this.tmpCol);
    this.sun.scale.setScalar(50 * (1 + 0.5 * lowSun));
    this.glow.scale.setScalar(160 * (1 + 0.5 * lowSun));

    this.sun.visible = this.enabled && sunUp > 0.01;
    this.glow.visible = this.enabled && sunUp > 0.01;
    this.moon.visible = this.enabled && moonUp > 0.01;
    this.moonGlow.visible = this.enabled && moonUp > 0.01;
  }

  // Project the sun to screen UV (0..1). Returns false if behind the camera.
  // Ensures camera matrices are current (this runs before the composer render).
  sunScreenPos(camera: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
    return this.screenPos(this.sun.position, camera, out);
  }

  // Same for the moon (underwater night light shafts).
  moonScreenPos(camera: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
    return this.screenPos(this.moon.position, camera, out);
  }

  private screenPos(target: THREE.Vector3, camera: THREE.PerspectiveCamera, out: THREE.Vector3): boolean {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.getWorldDirection(this.fwd);
    this.toSun.copy(target).sub(camera.position);
    if (this.toSun.dot(this.fwd) <= 0) return false; // behind camera
    this.worldPos.copy(target).project(camera); // -> NDC
    out.set((this.worldPos.x + 1) / 2, (this.worldPos.y + 1) / 2, 0);
    return true;
  }

  setVisible(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.sun.visible = false;
      this.glow.visible = false;
      this.moon.visible = false;
      this.moonGlow.visible = false;
    }
  }
}
