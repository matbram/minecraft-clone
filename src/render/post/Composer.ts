// Post-processing pipeline: RenderPass -> Bloom -> GodRays -> ACES tone map.
// Built once; setPreset only flips pass.enabled (no rebuild). The final enabled
// pass renders to screen automatically (EffectComposer handles renderToScreen).
//
// Note: we keep the existing gamma-ish color path (the world ShaderMaterial is
// already display-correct on a direct render). Effects are added on top; the ACES
// pass is a stylized grade, tunable via TONE_EXPOSURE. Low preset bypasses the
// composer entirely (direct renderer.render) for an identical-to-before look.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { createGodRaysPass } from './GodRaysPass';
import { createUnderwaterPass } from './UnderwaterPass';
import { BLOOM_THRESHOLD, BLOOM_STRENGTH, BLOOM_RADIUS, TONE_EXPOSURE } from '../../core/constants';
import type { QualitySettings } from '../Quality';

const ACES_PASS = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: TONE_EXPOSURE },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    varying vec2 vUv;
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb * uExposure;
      gl_FragColor = vec4(aces(col), 1.0);
    }
  `,
};

export class Composer {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly godrays: ShaderPass;
  private readonly underwater: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: QualitySettings,
  ) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Underwater warp first so bloom/god-rays act on the distorted image.
    this.underwater = createUnderwaterPass();
    this.underwater.enabled = false;
    this.composer.addPass(this.underwater);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);

    this.godrays = createGodRaysPass();
    this.composer.addPass(this.godrays);

    this.composer.addPass(new ShaderPass(ACES_PASS)); // always last -> renders to screen

    this.setPreset(settings);
    this.setSize(w, h, Math.min(window.devicePixelRatio, 2));
  }

  setPreset(s: QualitySettings): void {
    this.bloom.enabled = s.bloom;
    this.godrays.enabled = s.godRays;
  }

  updateGodRays(sunUv: THREE.Vector3, visible: boolean): void {
    (this.godrays.uniforms.uSunUv.value as THREE.Vector2).set(sunUv.x, sunUv.y);
    this.godrays.uniforms.uVisible.value = visible ? 1 : 0;
  }

  // Per-frame underwater distortion strength (0 = off/passthrough).
  setUnderwater(strength: number, time: number): void {
    this.underwater.enabled = strength > 0;
    this.underwater.uniforms.uStrength.value = strength;
    this.underwater.uniforms.uTime.value = time;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
