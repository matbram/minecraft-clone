// Piecewise-linear spline: map x through control points (xs ascending -> ys).
// Used by the terrain generator to shape noise fields into heights/amplitudes the
// way modern voxel terrain does (so most land sits near sea level and mountains are
// rare). PURE / worker-safe.

export function spline(x: number, xs: number[], ys: number[]): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  for (let i = 1; i < n; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[n - 1];
}
