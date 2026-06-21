// Phase 12.5b: a procedural equirectangular planet texture for the space-layer
// backdrop, painted once from the world seed in the biome palette (green/tan
// continents, blue oceans, white ice caps + cloud swirls). It's a cosmetic
// backdrop — no per-chunk accuracy — so it's cheap, deterministic value-noise.

import * as THREE from 'three';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// A value-noise grid that WRAPS in x (longitude) so there's no seam, and clamps
// in y (latitude) so the poles are stable.
function makeNoise(gx: number, gy: number, rnd: () => number): (u: number, v: number) => number {
  const g = new Float32Array(gx * gy);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (u, v) => {
    const fx = u * gx;
    const fy = v * gy;
    const x0 = ((Math.floor(fx) % gx) + gx) % gx;
    const x1 = (x0 + 1) % gx;
    const y0 = Math.max(0, Math.min(gy - 1, Math.floor(fy)));
    const y1 = Math.min(gy - 1, y0 + 1);
    const tx = smooth(fx - Math.floor(fx));
    const ty = smooth(fy - Math.floor(fy));
    const a = g[y0 * gx + x0];
    const b = g[y0 * gx + x1];
    const c = g[y1 * gx + x0];
    const d = g[y1 * gx + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function buildPlanetTexture(seed: number, W = 1024, H = 512): THREE.Texture {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  // fbm octaves for the continent mask (wrap in x).
  const oct = [
    { n: makeNoise(6, 4, rnd), a: 0.5 },
    { n: makeNoise(12, 8, rnd), a: 0.27 },
    { n: makeNoise(24, 16, rnd), a: 0.15 },
    { n: makeNoise(48, 32, rnd), a: 0.08 },
  ];
  const detail = makeNoise(64, 40, rnd); // small land-colour variation

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  const SEA = 0.5; // continent threshold (~higher = more ocean)
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const latC = v * 2 - 1; // -1 (north pole) .. +1 (south pole)
    const absLat = Math.abs(latC);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let n = 0;
      for (const o of oct) n += o.n(u, v) * o.a;
      // Bias toward more land in the mid-latitudes, ocean at the equator/poles.
      n += (1 - absLat) * 0.06 - smooth(Math.max(0, absLat - 0.75) / 0.25) * 0.15;

      let r: number, g: number, b: number;
      if (n < SEA) {
        // Ocean: deeper = darker blue; shallow shelf near coasts is lighter cyan.
        const depth = Math.min(1, (SEA - n) / 0.32);
        r = lerp(60, 12, depth);
        g = lerp(120, 38, depth);
        b = lerp(165, 86, depth);
      } else {
        // Land coloured by climate band (latitude), with small noise variation.
        const d = detail(u, v) - 0.5;
        if (absLat < 0.16) {
          // equatorial: lush jungle green
          r = 70; g = 150; b = 58;
        } else if (absLat < 0.34) {
          // subtropical dry belt: desert tan / savanna
          r = 196; g = 174; b = 110;
        } else if (absLat < 0.62) {
          // temperate: forest/plains green
          r = 96; g = 150; b = 78;
        } else {
          // boreal: muted green-brown toward tundra
          r = 120; g = 134; b = 96;
        }
        const f = 1 + d * 0.35;
        r *= f; g *= f; b *= f;
      }

      // Ice caps: blend land+ocean toward white near the poles.
      const cap = smooth(Math.max(0, absLat - 0.8) / 0.2);
      r = lerp(r, 244, cap);
      g = lerp(g, 248, cap);
      b = lerp(b, 255, cap);

      const i = (y * W + x) * 4;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Cloud swirls: soft white blobs on top (drawn wrapped so the seam is clean).
  const cr = mulberry32((seed ^ 0x51ed270b) >>> 0);
  for (let i = 0; i < 70; i++) {
    const cx = cr() * W;
    const cy = cr() * H;
    const rad = 18 + cr() * 80;
    const a = 0.05 + cr() * 0.14;
    for (const dx of [-W, 0, W]) {
      const g = ctx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, rad);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx + dx - rad, cy - rad, rad * 2, rad * 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
