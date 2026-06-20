// Crack overlay shown on the block currently being mined. A single reused
// 1.01³ box whose shader picks one crack stage from the strip texture.

import * as THREE from 'three';
import { BREAK_STAGES } from '../core/constants';

export class BreakOverlay {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, crackTex: THREE.Texture) {
    const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uCrack: { value: crackTex },
        uStage: { value: 0 },
        uStages: { value: BREAK_STAGES },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uCrack;
        uniform float uStage;
        uniform float uStages;
        varying vec2 vUv;
        void main() {
          vec2 cuv = vec2((vUv.x + uStage) / uStages, vUv.y);
          vec4 c = texture2D(uCrack, cuv);
          if (c.a < 0.02) discard;
          gl_FragColor = c;
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setStage(cell: { x: number; y: number; z: number } | null, stage: number): void {
    if (!cell || stage < 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.mat.uniforms.uStage.value = Math.max(0, Math.min(BREAK_STAGES - 1, stage));
  }
}
