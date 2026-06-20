// Main-thread worker pool + request queue for chunk generation.
//
// Keeps generation off the main thread and throttled: ChunkManager enqueues
// requests, and pump(n) dispatches up to n of them to free workers each frame.

import { chunkKey } from '../world/chunkKey';
import type { GenRequest, GenResponse } from './workerProtocol';

interface QueuedRequest {
  cx: number;
  cz: number;
  priority: number; // lower = sooner (distance to player)
}

export class GenScheduler {
  private readonly seed: number;
  private readonly workers: Worker[] = [];
  private readonly busy: boolean[] = [];
  private queue: QueuedRequest[] = [];
  private inFlight = new Map<number, string>(); // requestId -> chunkKey
  private requested = new Set<string>(); // chunkKeys queued or in flight
  private cancelled = new Set<string>(); // chunkKeys cancelled while in flight
  private nextId = 1;

  // Set by ChunkManager: receives completed chunk data.
  onChunk: (resp: GenResponse) => void = () => {};

  constructor(seed: number, poolSize?: number) {
    this.seed = seed;
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const n = poolSize ?? Math.max(1, Math.min(4, cores - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const wi = i;
      w.onmessage = (e: MessageEvent<GenResponse>) => this.handleResponse(wi, e.data);
      this.workers.push(w);
      this.busy.push(false);
    }
  }

  get poolSize(): number {
    return this.workers.length;
  }

  isRequested(cx: number, cz: number): boolean {
    return this.requested.has(chunkKey(cx, cz));
  }

  request(cx: number, cz: number, priority: number): void {
    const key = chunkKey(cx, cz);
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.queue.push({ cx, cz, priority });
  }

  // Cancel a chunk that left the load ring before it finished generating.
  cancel(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (!this.requested.has(key)) return;
    this.requested.delete(key);
    // Drop from the pending queue if not yet dispatched.
    this.queue = this.queue.filter((q) => !(q.cx === cx && q.cz === cz));
    // If already in flight, mark so its response is discarded on arrival.
    this.cancelled.add(key);
  }

  // Dispatch up to `max` queued requests to free workers this frame.
  pump(max: number): void {
    if (this.queue.length === 0) return;
    // Sort by priority (nearest first). Cheap given small per-frame counts.
    this.queue.sort((a, b) => a.priority - b.priority);

    let dispatched = 0;
    for (let i = 0; i < this.workers.length && dispatched < max; i++) {
      if (this.busy[i]) continue;
      const req = this.queue.shift();
      if (!req) break;
      const key = chunkKey(req.cx, req.cz);
      if (!this.requested.has(key)) continue; // cancelled before dispatch
      const id = this.nextId++;
      this.busy[i] = true;
      this.inFlight.set(id, key);
      const msg: GenRequest = { id, cx: req.cx, cz: req.cz, seed: this.seed };
      this.workers[i].postMessage(msg);
      dispatched++;
    }
  }

  private handleResponse(workerIndex: number, resp: GenResponse): void {
    this.busy[workerIndex] = false;
    const key = this.inFlight.get(resp.id);
    this.inFlight.delete(resp.id);

    if (key === undefined) return;
    this.requested.delete(key);

    if (this.cancelled.has(key)) {
      this.cancelled.delete(key);
      return; // chunk no longer wanted; drop the data
    }

    this.onChunk(resp);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
