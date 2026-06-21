// Sun + moon as physical 3D bodies (Phase 12.5). The sun is a bright additive
// sphere (blooms + feeds god rays); the moon is a lit, cratered sphere that shows
// a real waxing/waning PHASE (driven by DayNight.moonLightDir — visual only, so
// night WORLD lighting is unchanged). Each keeps a soft additive halo sprite for
// atmospheric glow, which fades out in vacuum (setSpace). Reports the sun/moon
// screen position for the god-rays pass. They sit at a large finite offset from
// the camera, so they read as distant bodies you can fly toward but never reach.

import * as THREE from 'three';
import {
  SUN_DIST,
  MOON_DIST,
  SUN_RADIUS,
  MOON_RADIUS,
  SUN_GLOW_SCALE,
  MOON_GLOW_SCALE,
} from '../core/constants';
import type { DayNight } from './DayNight';

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

// Greyish cratered moon surface: speckled base + a few darker "maria" and craters.
function moonTexture(size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  // small deterministic PRNG so the moon looks identical every run
  let s = 0xa53f9c1;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 1) >>> 0;
    return s / 4294967296;
  };
  // base
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = 0.82 + rnd() * 0.18;
      const v = Math.round(196 * f);
      ctx.fillStyle = `rgb(${v},${v},${Math.round(v * 1.02)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // dark maria
  for (let i = 0; i < 7; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.08 + rnd() * 0.12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(110,114,128,0.5)');
    g.addColorStop(1, 'rgba(110,114,128,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // craters: dark rim ring with a lighter center
  for (let i = 0; i < 40; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.012 + rnd() * 0.03);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120,124,138,0.5)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(225,228,238,0.35)';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const moonVert = `
varying vec3 vN;
varying vec2 vUv;
void main(){
  vN = normalize(mat3(modelMatrix) * normal); // sphere isn't rotated -> world normal
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const moonFrag = `
precision highp float;
uniform sampler2D uMap;
uniform vec3 uLightDir;  // world dir toward the light (drives the phase terminator)
uniform float uAmbient;  // dark-side floor so the unlit limb isn't pure black
uniform float uOpacity;
varying vec3 vN;
varying vec2 vUv;
void main(){
  float lit = max(0.0, dot(normalize(vN), normalize(uLightDir)));
  float shade = uAmbient + (1.0 - uAmbient) * lit;
  vec3 base = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(base * shade, uOpacity);
}`;

export class SunMoon {
  private readonly sun: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly moon: THREE.Mesh;
  private readonly moonGlow: THREE.Sprite;
  private readonly moonMat: THREE.ShaderMaterial;
  private readonly sunMat: THREE.MeshBasicMaterial;
  private readonly worldPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly toSun = new THREE.Vector3();
  private readonly tmpCol = new THREE.Color();
  private enabled = true;

  constructor(scene: THREE.Scene) {
    const glowTex = discTexture([
      [0, 'rgba(255,235,190,0.9)'],
      [0.3, 'rgba(255,210,150,0.35)'],
      [1, 'rgba(255,200,140,0)'],
    ]);
    const moonGlowTex = discTexture([
      [0, 'rgba(190,210,255,0.5)'],
      [0.35, 'rgba(150,180,245,0.18)'],
      [1, 'rgba(120,160,235,0)'],
    ]);

    // Sun: a bright additive sphere (reads as a glowing disc; blooms + god rays).
    this.sunMat = new THREE.MeshBasicMaterial({
      color: SUN_WHITE,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 24, 16), this.sunMat);

    // Moon: a lit, cratered sphere with a real phase.
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: moonTexture() },
        uLightDir: { value: new THREE.Vector3(0, 0, 1) },
        uAmbient: { value: 0.05 },
        uOpacity: { value: 1 },
      },
      vertexShader: moonVert,
      fragmentShader: moonFrag,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 32, 24), this.moonMat);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, fog: false }),
    );
    this.moonGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: moonGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, fog: false }),
    );
    this.glow.scale.setScalar(SUN_GLOW_SCALE);
    this.moonGlow.scale.setScalar(MOON_GLOW_SCALE);
    for (const o of [this.glow, this.sun, this.moonGlow, this.moon]) {
      // depthTest occludes them behind terrain; the sky dome/stars don't write
      // depth, so they still show against the sky. renderOrder -1 keeps them in
      // front of the sky dome (-4), stars (-3) and planet (-2), behind the world.
      o.renderOrder = -1;
      o.frustumCulled = false;
      scene.add(o);
    }
  }

  update(camPos: THREE.Vector3, day: DayNight): void {
    this.sun.position.copy(camPos).addScaledVector(day.sunDir, SUN_DIST);
    this.glow.position.copy(camPos).addScaledVector(day.sunDir, SUN_DIST);
    this.moon.position.copy(camPos).addScaledVector(day.moonDir, MOON_DIST);
    this.moonGlow.position.copy(camPos).addScaledVector(day.moonDir, MOON_DIST);

    // Fade out right at the horizon so a sub-horizon sun/moon doesn't linger.
    const sunUp = THREE.MathUtils.clamp(day.sunDir.y * 6 + 0.1, 0, 1);
    const moonUp = THREE.MathUtils.clamp(day.moonDir.y * 6 + 0.1, 0, 1);
    this.sunMat.opacity = sunUp;
    this.glow.material.opacity = sunUp;
    this.moonMat.uniforms.uOpacity.value = moonUp * 0.95;
    this.moonGlow.material.opacity = moonUp * 0.5;

    // Light the moon sphere from the phase direction (waxing/waning terminator).
    (this.moonMat.uniforms.uLightDir.value as THREE.Vector3).copy(day.moonLightDir);

    // Dramatic low sun: redden + enlarge the disc/glow as it nears the horizon.
    const lowSun = THREE.MathUtils.clamp(1 - day.sunDir.y / 0.25, 0, 1);
    this.tmpCol.copy(SUN_WHITE).lerp(SUN_LOW, lowSun);
    this.sunMat.color.copy(this.tmpCol);
    this.glow.material.color.copy(this.tmpCol);
    this.sun.scale.setScalar(1 + 0.5 * lowSun);
    this.glow.scale.setScalar(SUN_GLOW_SCALE * (1 + 0.5 * lowSun));

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

  // Phase 10 — underwater: dim the sun/moon with depth (light absorbed by water).
  // Call AFTER update(); fade=0 leaves them at their normal opacity.
  setUnderwaterFade(fade: number): void {
    const k = 1 - fade;
    this.sunMat.opacity *= k;
    this.glow.material.opacity *= k;
    this.moonMat.uniforms.uOpacity.value *= k;
    this.moonGlow.material.opacity *= k;
  }

  // Phase 12.5 — space: the soft atmospheric HALOS fade out in vacuum (no air to
  // scatter), while the sun/moon discs themselves stay. Call AFTER update().
  setSpace(altT: number): void {
    const k = 1 - altT;
    this.glow.material.opacity *= k;
    this.moonGlow.material.opacity *= k;
  }
}
