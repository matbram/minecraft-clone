// Main-thread worker pool for chunk MESHING (Phase 18.1). Mirrors GenScheduler but
// simpler: ChunkManager owns the dirty sets + nearest-first ordering and only dispatches
// when a worker is free (dispatch() returns false if the pool is saturated). Results are
// handed back via onResult; ChunkManager turns the typed arrays into BufferGeometry on the
// main thread (GPU upload must stay main-thread).

import type { MeshRequest, MeshResponse } from './meshProtocol';

export class MeshScheduler {
  private readonly workers: Worker[] = [];
  private readonly busy: boolean[] = [];

  // Set by ChunkManager: receives a finished mesh result.
  onResult: (res: MeshResponse) => void = () => {};

  constructor(poolSize?: number) {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    // Leave headroom for the main thread + the worldgen pool; meshing being OFF the main
    // thread is the win, not perfect core packing.
    const n = poolSize ?? Math.max(1, Math.min(4, cores - 2));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
      const wi = i;
      w.onmessage = (e: MessageEvent<MeshResponse>) => {
        this.busy[wi] = false;
        this.onResult(e.data);
      };
      this.workers.push(w);
      this.busy.push(false);
    }
  }

  get poolSize(): number {
    return this.workers.length;
  }

  get freeCount(): number {
    let n = 0;
    for (const b of this.busy) if (!b) n++;
    return n;
  }

  // Post a job to a free worker. Returns false if the pool is saturated (caller retries
  // next frame). Structured clone copies the chunk arrays (live arrays stay intact).
  dispatch(req: MeshRequest): boolean {
    const i = this.busy.indexOf(false);
    if (i < 0) return false;
    this.busy[i] = true;
    this.workers[i].postMessage(req);
    return true;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
