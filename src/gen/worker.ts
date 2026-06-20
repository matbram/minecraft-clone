/// <reference lib="webworker" />
//
// Generation worker. Imports ONLY DOM-free `core/` modules + the protocol types,
// so the bundle never pulls in THREE or DOM. Returns block data as transferable
// ArrayBuffers (zero-copy).

import { generateChunk } from '../core/WorldGen';
import type { GenRequest, GenResponse } from './workerProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<GenRequest>) => {
  const { id, cx, cz, seed } = e.data;
  const r = generateChunk(cx, cz, seed);

  const dataBuf = r.data.buffer as ArrayBuffer;
  const heightBuf = r.heightMap.buffer as ArrayBuffer;

  const msg: GenResponse = {
    id,
    cx,
    cz,
    data: dataBuf,
    heightMap: heightBuf,
    maxY: r.maxY,
    features: r.features,
  };

  // Transfer the two buffers (zero-copy). They are detached here afterward,
  // which is fine — this request is done with them.
  ctx.postMessage(msg, [dataBuf, heightBuf]);
};
